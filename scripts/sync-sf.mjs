/**
 * Salesforce data sync script.
 * Queries two data sources:
 *   1. Opportunities with ConstractType__c = 'レンタル' (rental)
 *   2. Maintenance__c (点検／修繕) records
 * Saves both as JSON for the construction-schedule app.
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'data');
const OPP_OUTPUT = join(DATA_DIR, 'opportunities.json');
const MAINT_OUTPUT = join(DATA_DIR, 'maintenances.json');

mkdirSync(DATA_DIR, { recursive: true });

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

writeFileSync(OPP_OUTPUT, JSON.stringify(opportunities, null, 2), 'utf-8');
console.log(`[sync-sf] Saved ${opportunities.length} rental opportunities to ${OPP_OUTPUT}`);

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

// ---- 2. Maintenance__c (点検／修繕) ----
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

writeFileSync(MAINT_OUTPUT, JSON.stringify(maintenances, null, 2), 'utf-8');
console.log(`[sync-sf] Saved ${maintenances.length} maintenance records to ${MAINT_OUTPUT}`);

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

// Category breakdown
const catCounts = {};
for (const m of maintenances) {
  const cat = m.category || '(none)';
  catCounts[cat] = (catCounts[cat] || 0) + 1;
}
console.log('[sync-sf] Maintenances by category:');
for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count}`);
}

console.log(`\n[sync-sf] Total: ${opportunities.length} opportunities + ${maintenances.length} maintenances`);
