/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect, useRef } from 'react';
import { isFirestoreEnabled, saveAssignments, loadAssignments, subscribeAssignments } from '../services/firestoreService';

const AppContext = createContext(null);

const STORAGE_KEYS = {
  assignments: 'construction-schedule-assignments',
  settings: 'construction-schedule-settings',
  tombstones: 'construction-schedule-deleted-ids',
};

// How long deleted IDs are remembered to block resurrection from a stale
// Firestore snapshot (in ms). 5 minutes is generous and survives a few
// page reloads while Firestore propagates.
const TOMBSTONE_TTL_MS = 5 * 60 * 1000;

function loadTombstones() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.tombstones);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const m = new Map();
    const now = Date.now();
    for (const [id, ts] of Object.entries(obj)) {
      if (now - ts < TOMBSTONE_TTL_MS) m.set(id, ts);
    }
    return m;
  } catch {
    return new Map();
  }
}

function persistTombstones(map) {
  try {
    const obj = Object.fromEntries(map);
    localStorage.setItem(STORAGE_KEYS.tombstones, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

const DEFAULT_SETTINGS = {
  workingHours: { start: '08:00', end: '18:00' },
  showWeekends: false,
  colorOutlookEvents: true,
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

  function rememberDeletion(id) {
    if (!id) return;
    tombstonesRef.current.set(id, Date.now());
    persistTombstones(tombstonesRef.current);
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

  // Wrap dispatch to record tombstones on delete
  const wrappedDispatch = (action) => {
    if (action.type === 'DELETE_ASSIGNMENT') {
      rememberDeletion(action.payload);
    }
    dispatch(action);
  };

  // Load from Firestore on mount and subscribe to real-time updates
  useEffect(() => {
    if (!isFirestoreEnabled()) return;

    // Initial load from Firestore — merge with local data to preserve
    // any assignments that failed to sync (e.g. Firestore save errors)
    loadAssignments().then((firestoreAssignments) => {
      const localAssignments = stateRef.current.assignments;
      const fsArray = filterTombstoned(firestoreAssignments || []);
      const fsIds = new Set(fsArray.map((a) => a.id));
      const localOnly = localAssignments.filter((a) => a.id && !fsIds.has(a.id));
      const merged = localOnly.length > 0 ? [...fsArray, ...localOnly] : fsArray;

      // Only dispatch if merged differs from local to avoid wiping data
      if (firestoreAssignments !== null || localOnly.length === 0) {
        fromFirestoreRef.current = true;
        dispatch({ type: 'SET_ASSIGNMENTS', payload: merged });
      }

      // Re-push merged state to Firestore if we recovered local-only items,
      // or if we filtered out tombstoned items still present on the server
      const fsHadTombstoned = (firestoreAssignments || []).length !== fsArray.length;
      if (localOnly.length > 0 || fsHadTombstoned) {
        saveAssignments(merged);
      }

      initialLoadDoneRef.current = true;
    });

    // Subscribe to real-time updates — merge to avoid losing local changes
    const unsubscribe = subscribeAssignments((firestoreAssignments) => {
      if (!initialLoadDoneRef.current) return; // Let initial load handle first
      const localAssignments = stateRef.current.assignments;
      const fsArray = filterTombstoned(firestoreAssignments);
      const fsIds = new Set(fsArray.map((a) => a.id));
      const localOnly = localAssignments.filter((a) => a.id && !fsIds.has(a.id));
      const merged = localOnly.length > 0
        ? [...fsArray, ...localOnly]
        : fsArray;
      fromFirestoreRef.current = true;
      dispatch({ type: 'SET_ASSIGNMENTS', payload: merged });

      // If the server still has tombstoned items, push the cleaned list back
      if (firestoreAssignments.length !== fsArray.length) {
        saveAssignments(merged);
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

    if (fromFirestoreRef.current) {
      fromFirestoreRef.current = false;
      return; // Don't save back to Firestore
    }
    saveAssignments(state.assignments);
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

  const value = {
    assignments: state.assignments,
    settings: state.settings,
    dispatch: wrappedDispatch,
  };

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
