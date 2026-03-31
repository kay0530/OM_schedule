/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useReducer, useEffect } from 'react';

const AppContext = createContext(null);

const STORAGE_KEYS = {
  assignments: 'construction-schedule-assignments',
  settings: 'construction-schedule-settings',
};

const DEFAULT_SETTINGS = {
  workingHours: { start: '08:00', end: '18:00' },
  showWeekends: false,
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
      const newAssignment = {
        id: `assign_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        isOutlookSynced: false,
        ...action.payload,
      };
      return { ...state, assignments: [...state.assignments, newAssignment] };
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

    default:
      console.warn(`Unknown action type: ${action.type}`);
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, null, loadInitialState);

  // Persist assignments to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEYS.assignments,
        JSON.stringify(state.assignments)
      );
    } catch {
      // Ignore quota errors
    }
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
    dispatch,
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
