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
 * Set up a real-time listener only AFTER the anonymous session is ready, so the
 * request carries request.auth (required by the locked rules). Returns a sync
 * unsubscribe that also cancels a not-yet-attached listener.
 * @param {() => import('firebase/firestore').Unsubscribe} attach
 * @returns {() => void}
 */
function subscribeWhenReady(attach) {
  if (!isFirestoreEnabled()) return () => {};
  let unsub = () => {};
  let cancelled = false;
  firebaseAuthReady.then(() => {
    if (cancelled) return;
    try {
      unsub = attach();
    } catch (e) {
      console.error('[Firestore] Failed to attach listener:', e);
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
 * Load assignments from Firestore.
 * A read FAILURE (offline start, auth/App Check hiccup) must be distinguishable
 * from "doc doesn't exist yet" — treating an error as an empty server would let
 * the caller overwrite the shared doc with local-only data.
 * @returns {Promise<{ok: boolean, data: Array|null}>} ok=false on read error;
 *   data=null when the doc doesn't exist (fresh project)
 */
export async function loadAssignments() {
  if (!isFirestoreEnabled()) return { ok: true, data: null };
  try {
    await firebaseAuthReady;
    const snap = await getDoc(doc(db, COLLECTION_ASSIGNMENTS, 'shared'));
    return { ok: true, data: snap.exists() ? snap.data().assignments || [] : null };
  } catch (e) {
    console.error('[Firestore] Failed to load assignments:', e);
    return { ok: false, data: null };
  }
}

/**
 * Subscribe to real-time assignment updates
 * @param {function} callback - Called with assignments array on each update
 * @returns {function} Unsubscribe function
 */
export function subscribeAssignments(callback) {
  return subscribeWhenReady(() =>
    onSnapshot(
      doc(db, COLLECTION_ASSIGNMENTS, 'shared'),
      (snap) => {
        if (snap.exists()) callback(snap.data().assignments || []);
      },
      (error) => console.error('[Firestore] Assignment subscription error:', error)
    )
  );
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
  return subscribeWhenReady(() =>
    onSnapshot(
      doc(db, COLLECTION_PRESETS, 'shared'),
      (snap) => {
        if (snap.exists()) callback(snap.data().presets || []);
      },
      (error) => console.error('[Firestore] Preset subscription error:', error)
    )
  );
}
