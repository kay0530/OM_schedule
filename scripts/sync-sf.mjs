/**
 * Salesforce data sync script.
 * Queries three data sources:
 *   1. Opportunities with ConstractType__c = 'レンタル' (rental)
 *   2. Opportunities with RecordType = 'PV'/新規 (self-consumption, 自家消費)
 *   3. Maintenance__c (点検／修繕) records
 * Uploads each dataset to Firestore (collection `om-schedule-sf-data`) as
 * chunked documents committed in one atomic batch. The app subscribes to the
 * collection, so synced data appears without a rebuild or redeploy.
 *
 * Customer data is intentionally NOT written to files: this repository is
 * public, so SF data must never be committed.
 *
 * Requires FIREBASE_SERVICE_ACCOUNT (Admin SDK credentials — JSON string or file
 * path; .env locally, GitHub Secret in CI). Admin writes bypass Firestore rules,
 * so the SF collection can stay read-only for browser clients.
 */
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Env: load .env for local runs (CI provides real env vars) ----
function loadDotEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
loadDotEnv(join(__dirname, '..', '.env'));

// Service account credentials for the Firebase Admin SDK. Admin writes bypass
// Firestore security rules, so the SF collection can be locked to read-only for
// browser clients. Provide FIREBASE_SERVICE_ACCOUNT as the JSON string (CI
// secret) or a path to the JSON file (local runs).
function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      console.error('[sync-sf] FIREBASE_SERVICE_ACCOUNT is not valid JSON:', e.message);
      return null;
    }
  }
  if (existsSync(trimmed)) {
    try {
      return JSON.parse(readFileSync(trimmed, 'utf-8'));
    } catch (e) {
      console.error('[sync-sf] Could not read service account file:', e.message);
      return null;
    }
  }
  return null;
}

const serviceAccount = loadServiceAccount();
if (!serviceAccount) {
  console.error('[sync-sf] FIREBASE_SERVICE_ACCOUNT not set (JSON string or file path) — cannot upload. Aborting.');
  process.exit(1);
}

/**
 * Execute a SOQL query via sf CLI and return parsed records.
 */
function queryRecords(query, label) {
  console.log(`[sync-sf] Querying ${label}...`);
  let result;
  try {
    result = execSync(`sf data query --query "${query}" --json`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
    if (err.stdout) {
      result = err.stdout;
    } else {
      console.error(`[sync-sf] Failed to query ${label}:`, err.message);
      return [];
    }
  }

  // Skip warning lines before JSON
  const jsonStart = result.indexOf('{');
  if (jsonStart === -1) {
    console.error(`[sync-sf] No JSON output for ${label}`);
    return [];
  }
  const parsed = JSON.parse(result.substring(jsonStart));

  if (parsed.status !== 0 && !parsed.result?.records) {
    console.error(`[sync-sf] Query failed for ${label}:`, parsed.message || 'Unknown error');
    return [];
  }

  return parsed.result.records || [];
}

// ---- 1. Opportunities (レンタル only) ----
const OPP_QUERY = `
SELECT Id, Name, StageName2__c, ConstractType__c, AccountId, Account.Name,
       LocationAddress__c, KojiSekouyoteibi__c, KojiSekoukiboubi__c,
       Kankobi__c, ConstructionCategory__c, ConstUser__c,
       AllSchaduleBikou__c, OwnerId,
       SurveyKakutei__c, KojiSekouKakuteibi__c
FROM Opportunity
WHERE ConstractType__c = 'レンタル'
  AND StageName2__c NOT IN ('失注', 'ペンディング', '99_完了')
ORDER BY KojiSekouyoteibi__c ASC NULLS LAST
`.trim().replace(/\n/g, ' ');

const oppRecords = queryRecords(OPP_QUERY, 'レンタル商談');

const opportunities = oppRecords.map((rec) => ({
  id: rec.Id,
  type: 'opportunity',
  name: rec.Name,
  stage: rec.StageName2__c || null,
  scheme: rec.ConstractType__c || null,
  accountName: rec.Account?.Name || null,
  address: rec.LocationAddress__c || null,
  constructionDate: rec.KojiSekouyoteibi__c || null,
  desiredDate: rec.KojiSekoukiboubi__c || null,
  completionDate: rec.Kankobi__c || null,
  category: rec.ConstructionCategory__c || null,
  constructionUserId: rec.ConstUser__c || null,
  scheduleMemo: rec.AllSchaduleBikou__c || null,
  ownerId: rec.OwnerId || null,
  surveyConfirmed: rec.SurveyKakutei__c || false,
  constructionDateConfirmed: rec.KojiSekouKakuteibi__c || false,
}));

console.log(`[sync-sf] Fetched ${opportunities.length} rental opportunities`);

// Stage breakdown
const stageCounts = {};
for (const opp of opportunities) {
  const stage = opp.stage || '(none)';
  stageCounts[stage] = (stageCounts[stage] || 0) + 1;
}
console.log('[sync-sf] Opportunities by stage:');
for (const [stage, count] of Object.entries(stageCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${stage}: ${count}`);
}

// ---- 2. Opportunities (自家消費 — RecordType = PV/新規) ----
const SELF_QUERY = `
SELECT Id, Name, StageName2__c, ConstractType__c, AccountId, Account.Name,
       LocationAddress__c, KojiSekouyoteibi__c, KojiSekoukiboubi__c,
       Kankobi__c, ConstructionCategory__c, ConstUser__c,
       AllSchaduleBikou__c, OwnerId,
       SurveyKakutei__c, KojiSekouKakuteibi__c
FROM Opportunity
WHERE RecordType.DeveloperName = 'PV'
  AND StageName2__c NOT IN ('失注', 'ペンディング', '99_完了')
ORDER BY KojiSekouyoteibi__c ASC NULLS LAST
`.trim().replace(/\n/g, ' ');

const selfRecords = queryRecords(SELF_QUERY, '自家消費');

const selfConsumption = selfRecords.map((rec) => ({
  id: rec.Id,
  type: 'self-consumption',
  name: rec.Name,
  stage: rec.StageName2__c || null,
  scheme: rec.ConstractType__c || null,
  accountName: rec.Account?.Name || null,
  address: rec.LocationAddress__c || null,
  constructionDate: rec.KojiSekouyoteibi__c || null,
  desiredDate: rec.KojiSekoukiboubi__c || null,
  completionDate: rec.Kankobi__c || null,
  category: rec.ConstructionCategory__c || null,
  constructionUserId: rec.ConstUser__c || null,
  scheduleMemo: rec.AllSchaduleBikou__c || null,
  ownerId: rec.OwnerId || null,
  surveyConfirmed: rec.SurveyKakutei__c || false,
  constructionDateConfirmed: rec.KojiSekouKakuteibi__c || false,
}));

console.log(`[sync-sf] Fetched ${selfConsumption.length} self-consumption opportunities`);

// Self-consumption stage breakdown
const selfStageCounts = {};
for (const opp of selfConsumption) {
  const stage = opp.stage || '(none)';
  selfStageCounts[stage] = (selfStageCounts[stage] || 0) + 1;
}
console.log('[sync-sf] Self-consumption by stage:');
for (const [stage, count] of Object.entries(selfStageCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${stage}: ${count}`);
}

// ---- 3. Maintenance__c (点検／修繕) ----
const MAINT_QUERY = `
SELECT Id, Name, Status__c, Category__c, Direction__c, Field2__c,
       Account__c, ScheduledDate__c, ExecEndDate__c, ExecDateKakutei__c,
       LocationAddress__c, Content__c, Result__c,
       Maintainer1__c, Maintainer2__c, Maintainer3__c,
       Opportunity__c, Gaiyou__c, OwnerId
FROM Maintenance__c
WHERE Status__c NOT IN ('完了')
ORDER BY ScheduledDate__c ASC NULLS LAST
`.trim().replace(/\n/g, ' ');

const maintRecords = queryRecords(MAINT_QUERY, '点検／修繕');

const maintenances = maintRecords.map((rec) => ({
  id: rec.Id,
  type: 'maintenance',
  name: rec.Name,
  summary: rec.Gaiyou__c || null,
  status: rec.Status__c || null,
  category: rec.Category__c || null,
  direction: rec.Direction__c || null,
  maintenanceType: rec.Field2__c || null,
  scheduledDate: rec.ScheduledDate__c || null,
  completionDate: rec.ExecEndDate__c || null,
  dateConfirmed: rec.ExecDateKakutei__c || false,
  address: rec.LocationAddress__c || null,
  content: rec.Content__c || null,
  result: rec.Result__c || null,
  maintainer1Id: rec.Maintainer1__c || null,
  maintainer2Id: rec.Maintainer2__c || null,
  maintainer3Id: rec.Maintainer3__c || null,
  opportunityId: rec.Opportunity__c || null,
  ownerId: rec.OwnerId || null,
}));

console.log(`[sync-sf] Fetched ${maintenances.length} maintenance records`);

// Status breakdown
const statusCounts = {};
for (const m of maintenances) {
  const status = m.status || '(none)';
  statusCounts[status] = (statusCounts[status] || 0) + 1;
}
console.log('[sync-sf] Maintenances by status:');
for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${status}: ${count}`);
}

// ---- Upload to Firestore ----
// Chunks of 200 records stay far below the 1MB document limit. One batched
// write keeps meta + all chunks atomic, so app snapshots never see a
// half-finished sync. Leftover chunk docs from larger past syncs are deleted.
const COLLECTION_SF_DATA = 'om-schedule-sf-data';
const CHUNK_SIZE = 200;

async function uploadToFirestore(datasets) {
  const app = initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore(app);
  const colRef = db.collection(COLLECTION_SF_DATA);

  const batch = db.batch();
  const expectedIds = new Set(['meta']);
  const chunkCounts = {};

  for (const [name, records] of Object.entries(datasets)) {
    const chunks = [];
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      chunks.push(records.slice(i, i + CHUNK_SIZE));
    }
    if (chunks.length === 0) chunks.push([]);
    chunkCounts[name] = chunks.length;
    chunks.forEach((chunkRecords, i) => {
      const id = `${name}-${i}`;
      expectedIds.add(id);
      batch.set(colRef.doc(id), { records: chunkRecords });
    });
  }

  batch.set(colRef.doc('meta'), {
    syncedAt: new Date().toISOString(),
    opportunityCount: datasets.opportunities.length,
    selfConsumptionCount: datasets.selfConsumption.length,
    maintenanceCount: datasets.maintenances.length,
    chunks: chunkCounts,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const existing = await colRef.get();
  existing.forEach((d) => {
    if (!expectedIds.has(d.id)) batch.delete(d.ref);
  });

  await batch.commit();
  console.log(`[sync-sf] Uploaded to Firestore (${serviceAccount.project_id}/${COLLECTION_SF_DATA}):`);
  for (const [name, count] of Object.entries(chunkCounts)) {
    console.log(`  ${name}: ${datasets[name].length} records in ${count} chunk(s)`);
  }
}

try {
  await uploadToFirestore({ opportunities, selfConsumption, maintenances });
} catch (err) {
  console.error('[sync-sf] Firestore upload failed:', err.message);
  process.exit(1);
}

console.log(`\n[sync-sf] Total: ${opportunities.length} rental + ${selfConsumption.length} self-consumption + ${maintenances.length} maintenances`);
process.exit(0);
