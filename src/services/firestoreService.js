import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

const COLLECTION_ASSIGNMENTS = 'om-schedule-assignments';
const COLLECTION_PRESETS = 'om-schedule-filter-presets';

/**
 * Check if Firestore is properly configured
 */
export function isFirestoreEnabled() {
  return !!db && !!import.meta.env.VITE_FIREBASE_PROJECT_ID;
}

// ========== Assignments ==========

/**
 * Save all assignments to Firestore (single document approach for simplicity)
 */
export async function saveAssignments(assignments) {
  if (!isFirestoreEnabled()) return;
  try {
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
  if (!isFirestoreEnabled()) return () => {};
  try {
    return onSnapshot(doc(db, COLLECTION_ASSIGNMENTS, 'shared'), (snap) => {
      if (snap.exists()) {
        callback(snap.data().assignments || []);
      }
    }, (error) => {
      console.error('[Firestore] Assignment subscription error:', error);
    });
  } catch (e) {
    console.error('[Firestore] Failed to subscribe assignments:', e);
    return () => {};
  }
}

// ========== Filter Presets ==========

/**
 * Save all filter presets to Firestore
 */
export async function saveFilterPresets(presets) {
  if (!isFirestoreEnabled()) return;
  try {
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
  if (!isFirestoreEnabled()) return () => {};
  try {
    return onSnapshot(doc(db, COLLECTION_PRESETS, 'shared'), (snap) => {
      if (snap.exists()) {
        callback(snap.data().presets || []);
      }
    }, (error) => {
      console.error('[Firestore] Preset subscription error:', error);
    });
  } catch (e) {
    console.error('[Firestore] Failed to subscribe presets:', e);
    return () => {};
  }
}
