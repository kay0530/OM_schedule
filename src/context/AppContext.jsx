/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { isFirestoreEnabled, saveAssignments, loadAssignments, subscribeAssignments } from '../services/firestoreService';
import { WORK_CATEGORY_IDS } from '../data/workCategories';
import { toISODate } from '../utils/dateUtils';

// Debounce Firestore writes — batches rapid edits (e.g. multi-member assign,
// Outlook reconcile sweep) into a single write to avoid hitting the
// "Write stream exhausted maximum allowed queued writes" error.
const FIRESTORE_WRITE_DEBOUNCE_MS = 800;

// Retention policy: assignments older than this are pruned from the shared
// Firestore doc on every write. The whole team's assignments live in ONE doc
// (hard cap 1 MiB) — without pruning it fills up within 1-2 years and every
// save starts failing silently. Past events remain in Outlook (and Salesforce),
// which are the systems of record — only the app's scheduling metadata is
// dropped. Surfaced to users in Settings > データ管理.
export const ASSIGNMENT_RETENTION_DAYS = 180;

// Warn well before the 1 MiB (1,048,576 B) Firestore document limit.
const DOC_SIZE_WARN_BYTES = 800_000;

function pruneOldAssignments(list) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - ASSIGNMENT_RETENTION_DAYS);
  const cutoffISO = toISODate(cutoff);
  // Items without a date are kept (defensive — assignments always carry one)
  return list.filter((a) => !a.date || a.date >= cutoffISO);
}

function makeDebouncedSaver(onResult) {
  let timer = null;
  let latestPayload = null;
  const fn = (payload) => {
    latestPayload = payload;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const p = latestPayload;
      timer = null;
      latestPayload = null;
      // flushStart: everything dispatched before this instant is contained in
      // `p` (each dispatch re-arms with fresh state) — lets the result handler
      // release pendingUpdates entries that this write just committed.
      const flushStart = Date.now();
      // Single choke point for ALL Firestore writes — retention pruning here
      // covers every path (edits, push-backs, re-based payloads)
      const result = await saveAssignments(pruneOldAssignments(p));
      if (onResult) onResult(result, flushStart);
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
  pendingUpdates: 'construction-schedule-pending-updates',
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

// PendingUpdates: id -> { fields: {field: value}, ts }. Locally UPDATEd fields
// not yet ack'd by Firestore. Unlike adds (pendingAdds) and deletes
// (tombstones), field updates had NO protection against being clobbered when a
// snapshot replaces the whole assignments array — a stale snapshot (own-write
// ack echo or a peer's whole-array write) could silently revert e.g. the
// outlookEventId link set right after an Outlook create ("仮のまま" bug).
const PENDING_UPDATE_TTL_MS = 60 * 1000;
// After our own write commits, keep the overlay for this grace window to
// absorb peers' in-flight stale whole-array writes, then let go so we don't
// fight a peer's legitimate subsequent edit of the same field.
const PENDING_UPDATE_COMMIT_GRACE_MS = 5 * 1000;
function loadPendingUpdates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.pendingUpdates);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const m = new Map();
    const now = Date.now();
    for (const [id, entry] of Object.entries(obj)) {
      if (entry && typeof entry.ts === 'number' && now - entry.ts < PENDING_UPDATE_TTL_MS) m.set(id, entry);
    }
    return m;
  } catch {
    return new Map();
  }
}
function persistPendingUpdates(map) {
  try {
    localStorage.setItem(STORAGE_KEYS.pendingUpdates, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // ignore
  }
}

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

  // Shared-save health, shown in the Header. error: the last debounced write
  // failed (edits reach localStorage but NOT other members — previously this
  // was silently swallowed). sizeWarning: the shared doc is approaching
  // Firestore's 1 MiB hard cap despite retention pruning.
  const [shareStatus, setShareStatus] = useState({ error: null, sizeWarning: false });

  // Tombstone map: id -> timestamp. Used to block resurrection of deleted
  // assignments by stale Firestore snapshots / late callbacks.
  const tombstonesRef = useRef(loadTombstones());

  // PendingAdds map: id -> timestamp. Items this client added that Firestore
  // may not have acknowledged yet. Used to decide which local-only items to
  // preserve when a Firestore snapshot arrives.
  const pendingAddsRef = useRef(loadPendingAdds());

  // PendingUpdates map: id -> {fields, ts}. Field-level UPDATEs this client
  // made that Firestore may not reflect yet — overlaid onto incoming
  // snapshots so a stale whole-array snapshot can't revert them.
  const pendingUpdatesRef = useRef(loadPendingUpdates());

  // Debounced Firestore writer — stable across renders (lazy init so the
  // result handler closure is created exactly once; setShareStatus is stable)
  const debouncedSaveRef = useRef(null);
  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = makeDebouncedSaver((result, flushStart) => {
      if (result.ok && flushStart) {
        // Our write (containing every field dispatched before flushStart)
        // committed on the server. Don't drop the entries immediately — a
        // peer's IN-FLIGHT stale array (armed before our write reached them)
        // can still land 1–2s later and clobber the fields. Stamp committedAt
        // instead: entries stay overlaid for a short grace window (see
        // overlayPendingUpdates), then expire, so a peer LEGITIMATELY editing
        // the same field afterwards isn't fought by a stale overlay.
        const pu = pendingUpdatesRef.current;
        let mutated = false;
        for (const entry of pu.values()) {
          if (entry.ts <= flushStart && !entry.committedAt) {
            entry.committedAt = Date.now();
            mutated = true;
          }
        }
        if (mutated) persistPendingUpdates(pu);
      }
      if (result.bytes > DOC_SIZE_WARN_BYTES) {
        console.warn(`[Firestore] assignments doc is ${Math.round(result.bytes / 1024)}KB — approaching the 1MiB document limit`);
      }
      setShareStatus({
        error: result.ok
          ? null
          : '共有への保存に失敗しました。この端末には保存されていますが、他のメンバーに変更が届いていない可能性があります。通信状態を確認してください。',
        sizeWarning: result.bytes > DOC_SIZE_WARN_BYTES,
      });
    });
  }

  function rememberDeletion(id) {
    if (!id) return;
    tombstonesRef.current.set(id, Date.now());
    persistTombstones(tombstonesRef.current);
    // If the deleted item was pending an add, drop the pending too
    if (pendingAddsRef.current.delete(id)) {
      persistPendingAdds(pendingAddsRef.current);
    }
    if (pendingUpdatesRef.current.delete(id)) {
      persistPendingUpdates(pendingUpdatesRef.current);
    }
  }

  function rememberPendingUpdate(id, fields) {
    if (!id || !fields) return;
    const prev = pendingUpdatesRef.current.get(id);
    pendingUpdatesRef.current.set(id, {
      fields: { ...(prev ? prev.fields : null), ...fields },
      ts: Date.now(),
    });
    persistPendingUpdates(pendingUpdatesRef.current);
  }

  // Overlay locally-pending field updates onto a Firestore snapshot array.
  // Entries are released once a SERVER snapshot carries the same values (ack)
  // or when they expire (TTL) — mirrors ackPendingAdds/gcPendingAdds.
  // fromServer=false for the local write echo (hasPendingWrites): the echo
  // always carries our own values, so acking there would release protection
  // ~800ms after dispatch and leave a peer's stale in-flight write unguarded.
  function overlayPendingUpdates(list, fromServer) {
    const pu = pendingUpdatesRef.current;
    if (pu.size === 0) return list;
    const now = Date.now();
    let mutated = false;
    for (const [id, entry] of pu) {
      // Expire: hard TTL, or grace window elapsed after our own server commit
      // (committedAt is stamped by the debounced-save result handler).
      if (
        now - entry.ts >= PENDING_UPDATE_TTL_MS ||
        (entry.committedAt && now - entry.committedAt >= PENDING_UPDATE_COMMIT_GRACE_MS)
      ) {
        pu.delete(id);
        mutated = true;
      }
    }
    if (fromServer && pu.size > 0) {
      // Release orphans: ids absent from a server snapshot were deleted by a
      // peer or pruned by retention — they can never be acked and would keep
      // puDirty armed (≈800ms self-write loop until TTL). Ids still in
      // pendingAdds are exempt: the item itself hasn't reached the server yet.
      const listIds = new Set(list.map((a) => a.id));
      for (const id of [...pu.keys()]) {
        if (!listIds.has(id) && !pendingAddsRef.current.has(id)) {
          pu.delete(id);
          mutated = true;
        }
      }
    }
    if (mutated) persistPendingUpdates(pu);
    if (pu.size === 0) return list;
    let ackMutated = false;
    const result = list.map((a) => {
      const entry = pu.get(a.id);
      if (!entry) return a;
      const acked = Object.entries(entry.fields).every(([k, v]) => a[k] === v);
      if (acked) {
        if (fromServer) {
          pu.delete(a.id);
          ackMutated = true;
        }
        return a;
      }
      return { ...a, ...entry.fields };
    });
    if (ackMutated) persistPendingUpdates(pu);
    return result;
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
    } else if (action.type === 'UPDATE_ASSIGNMENT') {
      const { id, ...fields } = action.payload || {};
      if (id && Object.keys(fields).length > 0) rememberPendingUpdate(id, fields);
    } else if (action.type === 'UPDATE_ASSIGNMENTS_BULK') {
      const { ids, updates } = action.payload || {};
      if (ids && updates) ids.forEach((id) => rememberPendingUpdate(id, updates));
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
      // Initial data is server-confirmed → allow pending-update acks
      const fsArray = overlayPendingUpdates(filterTombstoned(firestoreAssignments || []), true);
      // Entries still pending after overlay = the server lacks those field
      // values — push the merged state back so they aren't lost server-side
      const puDirty = pendingUpdatesRef.current.size > 0;
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

      // Push back to Firestore if we recovered pending-adds/updates OR
      // filtered tombstoned items from the server snapshot
      const fsHadTombstoned = (firestoreAssignments || []).length !== fsArray.length;
      if (localPending.length > 0 || fsHadTombstoned || puDirty) {
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
    const unsubscribe = subscribeAssignments((firestoreAssignments, meta) => {
      const fromServer = !!meta?.fromServer;
      if (!initialLoadDoneRef.current) {
        // Initial getDoc failed or hasn't resolved yet — treat the first live
        // snapshot as the initial load (bootstraps pendingAdds/tombstone
        // handling and re-enables writes).
        runInitialMerge(firestoreAssignments);
        return;
      }
      gcPendingAdds();
      const localAssignments = stateRef.current.assignments;
      const fsArray = overlayPendingUpdates(filterTombstoned(firestoreAssignments), fromServer);
      // Unacked field updates remaining on a SERVER snapshot = a peer's write
      // clobbered them server-side → push back. Never re-arm on our own write
      // echo — with pending entries that would self-oscillate (write → echo →
      // write …) until the entries expire.
      const puDirty = fromServer && pendingUpdatesRef.current.size > 0;
      const fsIds = new Set(fsArray.map((a) => a.id));
      ackPendingAdds(fsIds);
      const localPending = localAssignments.filter(
        (a) => a.id && !fsIds.has(a.id) && pendingAddsRef.current.has(a.id)
      );
      const merged = localPending.length > 0 ? [...fsArray, ...localPending] : fsArray;

      fromFirestoreRef.current = true;
      dispatch({ type: 'SET_ASSIGNMENTS', payload: merged });

      if (firestoreAssignments.length !== fsArray.length || puDirty) {
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
      shareStatus,
    }),
    [state.assignments, state.settings, wrappedDispatch, shareStatus]
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
