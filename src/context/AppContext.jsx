/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useRef, useCallback, useMemo } from 'react';
import { isFirestoreEnabled, saveAssignments, loadAssignments, subscribeAssignments } from '../services/firestoreService';
import { WORK_CATEGORY_IDS } from '../data/workCategories';

// Debounce Firestore writes — batches rapid edits (e.g. multi-member assign,
// Outlook reconcile sweep) into a single write to avoid hitting the
// "Write stream exhausted maximum allowed queued writes" error.
const FIRESTORE_WRITE_DEBOUNCE_MS = 800;

function makeDebouncedSaver() {
  let timer = null;
  let latestPayload = null;
  const fn = (payload) => {
    latestPayload = payload;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const p = latestPayload;
      timer = null;
      latestPayload = null;
      saveAssignments(p);
    }, FIRESTORE_WRITE_DEBOUNCE_MS);
  };
  fn.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    latestPayload = null;
  };
  // True while a write is armed but not yet flushed — used to re-base the
  // pending payload when a fresher snapshot arrives.
  fn.isPending = () => timer !== null;
  return fn;
}

const AppContext = createContext(null);

// NOTE: if the `settings` key ever changes, also update the FOUC guard
// script in index.html which reads it before React mounts.
const STORAGE_KEYS = {
  assignments: 'construction-schedule-assignments',
  settings: 'construction-schedule-settings',
  tombstones: 'construction-schedule-deleted-ids',
  pendingAdds: 'construction-schedule-pending-adds',
};

// How long deleted IDs are remembered to block resurrection from a stale
// Firestore snapshot (in ms). 5 minutes is generous and survives a few
// page reloads while Firestore propagates.
const TOMBSTONE_TTL_MS = 5 * 60 * 1000;
// How long locally added IDs are protected from being wiped by a Firestore
// snapshot that hasn't ack'd the add yet. After this they're treated as
// "should have synced by now"; if FS still doesn't have them, they were
// most likely deleted by a peer.
const PENDING_ADD_TTL_MS = 60 * 1000;

function loadIdMap(storageKey, ttlMs) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const m = new Map();
    const now = Date.now();
    for (const [id, ts] of Object.entries(obj)) {
      if (now - ts < ttlMs) m.set(id, ts);
    }
    return m;
  } catch {
    return new Map();
  }
}

function persistIdMap(storageKey, map) {
  try {
    const obj = Object.fromEntries(map);
    localStorage.setItem(storageKey, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

function loadTombstones() { return loadIdMap(STORAGE_KEYS.tombstones, TOMBSTONE_TTL_MS); }
function persistTombstones(map) { persistIdMap(STORAGE_KEYS.tombstones, map); }
function loadPendingAdds() { return loadIdMap(STORAGE_KEYS.pendingAdds, PENDING_ADD_TTL_MS); }
function persistPendingAdds(map) { persistIdMap(STORAGE_KEYS.pendingAdds, map); }

const DEFAULT_SETTINGS = {
  workingHours: { start: '08:00', end: '18:00' },
  showWeekends: false,
  colorOutlookEvents: true,
  // 'light' | 'dark' | 'system' — per-device personal preference.
  // NOTE: settings are NOT synced to Firestore (assignments only); if that
  // ever changes, exclude `theme` from the sync.
  theme: 'light',
  // Shared view filters (hidden-list form so newly added members/categories
  // default to visible). '__none__' = uncategorized in hiddenCategoryIds.
  hiddenMemberIds: [],
  hiddenCategoryIds: [],
  viewAxis: 'date', // 'date' | 'person' (週間ビュー)
};

/**
 * Load state from localStorage with fallback defaults.
 */
function loadInitialState() {
  let assignments = [];
  let settings = DEFAULT_SETTINGS;

  try {
    const rawAssignments = localStorage.getItem(STORAGE_KEYS.assignments);
    if (rawAssignments) {
      assignments = JSON.parse(rawAssignments);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEYS.assignments);
  }

  try {
    const rawSettings = localStorage.getItem(STORAGE_KEYS.settings);
    if (rawSettings) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(rawSettings) };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEYS.settings);
  }

  // One-time migration of pre-settings filter keys (view axis + visible
  // categories lived in their own localStorage keys until the toolbar rework).
  // READ-ONLY here: StrictMode double-invokes this initializer in dev, so
  // removing the old keys on first call would make the kept second call see
  // nothing. Deletion happens in a mount effect in AppProvider.
  try {
    const oldAxis = localStorage.getItem('construction-schedule-view-axis');
    if (oldAxis) {
      settings = { ...settings, viewAxis: oldAxis === 'person' ? 'person' : 'date' };
    }
    const oldCats = localStorage.getItem('construction-schedule-visible-categories');
    if (oldCats) {
      const visible = JSON.parse(oldCats);
      if (Array.isArray(visible)) {
        // Old format was a VISIBLE list; convert to hidden list
        const all = [...WORK_CATEGORY_IDS, '__none__'];
        settings = { ...settings, hiddenCategoryIds: all.filter((id) => !visible.includes(id)) };
      }
    }
  } catch {
    // ignore migration errors
  }

  return { assignments, settings };
}

/**
 * Reducer handling assignment and settings actions.
 */
function appReducer(state, action) {
  switch (action.type) {
    case 'ADD_ASSIGNMENT': {
      const payload = action.payload;
      const newAssignment = {
        id: payload.id || `assign_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        isOutlookSynced: false,
        ...payload,
      };
      return { ...state, assignments: [...state.assignments, newAssignment] };
    }

    case 'UPDATE_ASSIGNMENTS_BULK': {
      const { ids, updates } = action.payload;
      const idSet = new Set(ids);
      return {
        ...state,
        assignments: state.assignments.map((a) =>
          idSet.has(a.id) ? { ...a, ...updates } : a
        ),
      };
    }

    case 'UPDATE_ASSIGNMENT': {
      const { id, ...updates } = action.payload;
      return {
        ...state,
        assignments: state.assignments.map((a) =>
          a.id === id ? { ...a, ...updates } : a
        ),
      };
    }

    case 'DELETE_ASSIGNMENT':
      return {
        ...state,
        assignments: state.assignments.filter((a) => a.id !== action.payload),
      };

    case 'UPDATE_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.payload },
      };

    case 'SET_ASSIGNMENTS':
      return { ...state, assignments: action.payload };

    default:
      console.warn(`Unknown action type: ${action.type}`);
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, null, loadInitialState);
  const fromFirestoreRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const initialLoadDoneRef = useRef(false);

  // Tombstone map: id -> timestamp. Used to block resurrection of deleted
  // assignments by stale Firestore snapshots / late callbacks.
  const tombstonesRef = useRef(loadTombstones());

  // PendingAdds map: id -> timestamp. Items this client added that Firestore
  // may not have acknowledged yet. Used to decide which local-only items to
  // preserve when a Firestore snapshot arrives.
  const pendingAddsRef = useRef(loadPendingAdds());

  // Debounced Firestore writer — stable across renders
  const debouncedSaveRef = useRef(makeDebouncedSaver());

  function rememberDeletion(id) {
    if (!id) return;
    tombstonesRef.current.set(id, Date.now());
    persistTombstones(tombstonesRef.current);
    // If the deleted item was pending an add, drop the pending too
    if (pendingAddsRef.current.delete(id)) {
      persistPendingAdds(pendingAddsRef.current);
    }
  }

  function rememberPendingAdd(id) {
    if (!id) return;
    pendingAddsRef.current.set(id, Date.now());
    persistPendingAdds(pendingAddsRef.current);
  }

  function gcPendingAdds() {
    const now = Date.now();
    let mutated = false;
    for (const [id, ts] of pendingAddsRef.current) {
      if (now - ts >= PENDING_ADD_TTL_MS) {
        pendingAddsRef.current.delete(id);
        mutated = true;
      }
    }
    if (mutated) persistPendingAdds(pendingAddsRef.current);
  }

  function ackPendingAdds(fsIds) {
    let mutated = false;
    for (const id of pendingAddsRef.current.keys()) {
      if (fsIds.has(id)) {
        pendingAddsRef.current.delete(id);
        mutated = true;
      }
    }
    if (mutated) persistPendingAdds(pendingAddsRef.current);
  }

  function filterTombstoned(list) {
    const now = Date.now();
    // GC expired tombstones
    let mutated = false;
    for (const [id, ts] of tombstonesRef.current) {
      if (now - ts >= TOMBSTONE_TTL_MS) {
        tombstonesRef.current.delete(id);
        mutated = true;
      }
    }
    if (mutated) persistTombstones(tombstonesRef.current);
    if (tombstonesRef.current.size === 0) return list;
    return list.filter((a) => !tombstonesRef.current.has(a.id));
  }

  // Wrap dispatch to record tombstones on delete and pending on add.
  // useCallback for stable identity so downstream useEffects don't re-fire
  // each render.
  const wrappedDispatch = useCallback((action) => {
    if (action.type === 'DELETE_ASSIGNMENT') {
      rememberDeletion(action.payload);
    } else if (action.type === 'ADD_ASSIGNMENT') {
      // Compute the id the reducer will assign (mirrors reducer logic)
      const id = action.payload?.id || null;
      // If no id provided, generate one here so we can track it pre-dispatch
      if (!id) {
        const generated = `assign_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        action = { ...action, payload: { ...action.payload, id: generated } };
        rememberPendingAdd(generated);
      } else {
        rememberPendingAdd(id);
      }
    }
    dispatch(action);
  }, []);

  // Load from Firestore on mount and subscribe to real-time updates
  useEffect(() => {
    if (!isFirestoreEnabled()) return;

    // Initial merge of a server array into local state: take Firestore as
    // source of truth, only preserve *recently added* local items that may
    // not have synced yet. Shared by the initial getDoc load and — when that
    // load fails — the first live snapshot.
    const runInitialMerge = (firestoreAssignments) => {
      gcPendingAdds();
      const localAssignments = stateRef.current.assignments;
      const fsArray = filterTombstoned(firestoreAssignments || []);
      const fsIds = new Set(fsArray.map((a) => a.id));
      ackPendingAdds(fsIds);
      // Only preserve local items that are in the pendingAdds set
      const localPending = localAssignments.filter(
        (a) => a.id && !fsIds.has(a.id) && pendingAddsRef.current.has(a.id)
      );
      const merged = localPending.length > 0 ? [...fsArray, ...localPending] : fsArray;

      if (firestoreAssignments !== null || localPending.length === 0) {
        fromFirestoreRef.current = true;
        dispatch({ type: 'SET_ASSIGNMENTS', payload: merged });
      }

      // Push back to Firestore if we recovered pending-adds OR filtered
      // tombstoned items from the server snapshot
      const fsHadTombstoned = (firestoreAssignments || []).length !== fsArray.length;
      if (localPending.length > 0 || fsHadTombstoned) {
        debouncedSaveRef.current(merged);
      }

      initialLoadDoneRef.current = true;
    };

    loadAssignments().then(({ ok, data }) => {
      if (!ok) {
        // Read FAILED (offline start, auth/App Check hiccup) — this is NOT
        // "doc missing". Leave initialLoadDoneRef unset so the persist effect
        // keeps cancelling Firestore writes (local-only degraded mode); the
        // first successful live snapshot below performs the initial merge and
        // re-enables writes. Overwriting the shared doc from this state once
        // wiped the whole team's data.
        console.warn('[AppContext] Initial Firestore load failed — deferring to first snapshot.');
        return;
      }
      // Guard: the live snapshot may have bootstrapped us first
      if (!initialLoadDoneRef.current) runInitialMerge(data);
    });

    // Subscribe to real-time updates — trust Firestore as truth, only
    // preserve recently added local items pending FS acknowledgement
    const unsubscribe = subscribeAssignments((firestoreAssignments) => {
      if (!initialLoadDoneRef.current) {
        // Initial getDoc failed or hasn't resolved yet — treat the first live
        // snapshot as the initial load (bootstraps pendingAdds/tombstone
        // handling and re-enables writes).
        runInitialMerge(firestoreAssignments);
        return;
      }
      gcPendingAdds();
      const localAssignments = stateRef.current.assignments;
      const fsArray = filterTombstoned(firestoreAssignments);
      const fsIds = new Set(fsArray.map((a) => a.id));
      ackPendingAdds(fsIds);
      const localPending = localAssignments.filter(
        (a) => a.id && !fsIds.has(a.id) && pendingAddsRef.current.has(a.id)
      );
      const merged = localPending.length > 0 ? [...fsArray, ...localPending] : fsArray;

      fromFirestoreRef.current = true;
      dispatch({ type: 'SET_ASSIGNMENTS', payload: merged });

      if (firestoreAssignments.length !== fsArray.length) {
        debouncedSaveRef.current(merged);
      }
    });

    return unsubscribe;
  }, []);

  // Persist assignments to localStorage and Firestore
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.assignments,
        JSON.stringify(state.assignments)
      );
    } catch {
      // Ignore quota errors
    }

    // CRITICAL: do not write to Firestore until our initial load from
    // Firestore has completed. Otherwise a brand-new client (empty
    // localStorage) would queue saveAssignments([]) on mount, then 800ms
    // later overwrite all other clients' data with an empty array.
    if (isFirestoreEnabled() && !initialLoadDoneRef.current) {
      // Drop any payload that was queued before we knew about the server
      debouncedSaveRef.current.cancel();
      return;
    }

    if (fromFirestoreRef.current) {
      fromFirestoreRef.current = false;
      // Re-base an armed (not yet flushed) write onto the just-merged snapshot
      // state: a payload captured BEFORE the snapshot would otherwise flush
      // later and erase the peer's change from the server. Do NOT cancel here —
      // the load/snapshot paths intentionally queue push-back writes
      // (tombstone filtering / pendingAdds recovery) right before this effect.
      if (debouncedSaveRef.current.isPending()) {
        debouncedSaveRef.current(state.assignments);
      }
      return; // Don't save back to Firestore
    }
    debouncedSaveRef.current(state.assignments);
  }, [state.assignments]);

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.settings,
        JSON.stringify(state.settings)
      );
    } catch {
      // Ignore quota errors
    }
  }, [state.settings]);

  // Drop legacy filter keys once the migrated settings have been persisted
  // (kept out of loadInitialState — see the StrictMode note there)
  useEffect(() => {
    try {
      localStorage.removeItem('construction-schedule-view-axis');
      localStorage.removeItem('construction-schedule-visible-categories');
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({
      assignments: state.assignments,
      settings: state.settings,
      dispatch: wrappedDispatch,
    }),
    [state.assignments, state.settings, wrappedDispatch]
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
