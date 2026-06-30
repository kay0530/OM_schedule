import { collection, onSnapshot } from 'firebase/firestore';
import { db, firebaseAuthReady } from '../firebase';

/**
 * Salesforce data delivery via Firestore.
 *
 * The sync workflow (scripts/sync-sf.mjs) writes each dataset as chunked
 * documents in the `om-schedule-sf-data` collection:
 *   - `meta`                : { syncedAt, *Count, chunks: { <name>: n } }
 *   - `<name>-<i>`          : { records: [...] } (i = 0..chunks[name]-1)
 * Datasets: opportunities / selfConsumption / maintenances.
 *
 * Chunking keeps each document well below Firestore's 1MB limit; all chunks
 * plus meta are committed in a single batch, so a snapshot is always a
 * consistent view of one sync run.
 */

const COLLECTION_SF_DATA = 'om-schedule-sf-data';

const DATASET_NAMES = ['opportunities', 'selfConsumption', 'maintenances'];

function assembleDataset(docs, meta, name) {
  const chunkCount = meta?.chunks?.[name];
  const ids = chunkCount != null
    ? Array.from({ length: chunkCount }, (_, i) => `${name}-${i}`)
    : [...docs.keys()]
        .filter((id) => id.startsWith(`${name}-`))
        .sort((a, b) => Number(a.slice(name.length + 1)) - Number(b.slice(name.length + 1)));
  return ids.flatMap((id) => docs.get(id)?.records || []);
}

/**
 * Subscribe to real-time SF data updates.
 * @param {function} callback - Called with { opportunities, selfConsumption, maintenances, syncMeta }
 * @returns {function} Unsubscribe function
 */
export function subscribeSfData(callback) {
  if (!db) return () => {};
  let unsub = () => {};
  let cancelled = false;
  // Wait for the (anonymous) sign-in so locked rules don't deny the first read.
  firebaseAuthReady.then(() => {
    if (cancelled) return;
    try {
      unsub = onSnapshot(collection(db, COLLECTION_SF_DATA), (snap) => {
        const docs = new Map();
        snap.forEach((d) => docs.set(d.id, d.data()));
        const syncMeta = docs.get('meta') || null;
        const result = { syncMeta };
        for (const name of DATASET_NAMES) {
          result[name] = assembleDataset(docs, syncMeta, name);
        }
        callback(result);
      }, (error) => {
        console.error('[Firestore] SF data subscription error:', error);
      });
    } catch (e) {
      console.error('[Firestore] Failed to subscribe SF data:', e);
    }
  });
  return () => {
    cancelled = true;
    unsub();
  };
}
