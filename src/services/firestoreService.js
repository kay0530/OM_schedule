import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db, firebaseAuthReady } from '../firebase';

const COLLECTION_ASSIGNMENTS = 'om-schedule-assignments';
const COLLECTION_PRESETS = 'om-schedule-filter-presets';

/**
 * Check if Firestore is properly configured
 */
export function isFirestoreEnabled() {
  return !!db && !!import.meta.env.VITE_FIREBASE_PROJECT_ID;
}

/**
 * Subscribe to a single shared document once the (anonymous) sign-in has settled,
 * so a locked rule set never denies the initial listen before auth is ready.
 * Returns an unsubscribe that also cancels a not-yet-attached listener.
 */
function subscribeShared(collectionName, field, callback, label) {
  if (!isFirestoreEnabled()) return () => {};
  let unsub = () => {};
  let cancelled = false;
  firebaseAuthReady.then(() => {
    if (cancelled) return;
    try {
      unsub = onSnapshot(
        doc(db, collectionName, 'shared'),
        (snap) => {
          if (snap.exists()) callback(snap.data()[field] || []);
        },
        (error) => console.error(`[Firestore] ${label} subscription error:`, error)
      );
    } catch (e) {
      console.error(`[Firestore] Failed to subscribe ${label}:`, e);
    }
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

// ========== Assignments ==========

/**
 * Save all assignments to Firestore (single document approach for simplicity)
 */
export async function saveAssignments(assignments) {
  if (!isFirestoreEnabled()) return;
  try {
    await firebaseAuthReady;
    await setDoc(doc(db, COLLECTION_ASSIGNMENTS, 'shared'), {
      assignments,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('[Firestore] Failed to save assignments:', e);
  }
}

/**
 * Load assignments from Firestore
 * @returns {Array|null}
 */
export async function loadAssignments() {
  if (!isFirestoreEnabled()) return null;
  try {
    await firebaseAuthReady;
    const snap = await getDoc(doc(db, COLLECTION_ASSIGNMENTS, 'shared'));
    return snap.exists() ? snap.data().assignments || [] : null;
  } catch (e) {
    console.error('[Firestore] Failed to load assignments:', e);
    return null;
  }
}

/**
 * Subscribe to real-time assignment updates
 * @param {function} callback - Called with assignments array on each update
 * @returns {function} Unsubscribe function
 */
export function subscribeAssignments(callback) {
  return subscribeShared(COLLECTION_ASSIGNMENTS, 'assignments', callback, 'Assignment');
}

// ========== Filter Presets ==========

/**
 * Save all filter presets to Firestore
 */
export async function saveFilterPresets(presets) {
  if (!isFirestoreEnabled()) return;
  try {
    await firebaseAuthReady;
    await setDoc(doc(db, COLLECTION_PRESETS, 'shared'), {
      presets,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error('[Firestore] Failed to save presets:', e);
  }
}

/**
 * Load filter presets from Firestore
 * @returns {Array|null}
 */
export async function loadFilterPresets() {
  if (!isFirestoreEnabled()) return null;
  try {
    await firebaseAuthReady;
    const snap = await getDoc(doc(db, COLLECTION_PRESETS, 'shared'));
    return snap.exists() ? snap.data().presets || [] : null;
  } catch (e) {
    console.error('[Firestore] Failed to load presets:', e);
    return null;
  }
}

/**
 * Subscribe to real-time preset updates
 * @param {function} callback - Called with presets array on each update
 * @returns {function} Unsubscribe function
 */
export function subscribeFilterPresets(callback) {
  return subscribeShared(COLLECTION_PRESETS, 'presets', callback, 'Preset');
}
