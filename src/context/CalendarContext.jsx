/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const CalendarContext = createContext(null);

const STORAGE_KEY = 'construction-schedule-calendar-events';

/**
 * Load events from localStorage, falling back to empty array.
 * @returns {Array} Persisted calendar events or empty array
 */
function loadPersistedEvents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return data.events || [];
    }
  } catch {
    // Ignore parse errors, fall through to empty
    localStorage.removeItem(STORAGE_KEY);
  }
  return [];
}

/**
 * Save events to localStorage.
 * @param {Array} events
 */
function persistEvents(events) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ events }));
  } catch {
    // Ignore quota errors
  }
}

export function CalendarProvider({ children }) {
  const [events, setEventsState] = useState(() => loadPersistedEvents());
  const [loading, setLoading] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [syncError, setSyncError] = useState(null);

  // Persist events whenever they change
  useEffect(() => {
    persistEvents(events);
  }, [events]);

  // Replace all events
  const setEvents = useCallback((newEvents) => {
    setEventsState(newEvents);
    setLastSynced(new Date().toISOString());
    setSyncError(null);
  }, []);

  // Append events without duplicates
  const addEvents = useCallback((newEvents) => {
    setEventsState((prev) => {
      const existingIds = new Set(prev.map((e) => e.id));
      const unique = newEvents.filter((e) => !existingIds.has(e.id));
      return [...prev, ...unique];
    });
    setLastSynced(new Date().toISOString());
    setSyncError(null);
  }, []);

  // Merge events: replace events within a date range, keep events outside it.
  // - Prior copies of re-fetched ids are dropped (a multi-day event straddling
  //   the range boundary would otherwise appear twice).
  // - keepEmails (optional Set of lowercase emails): members whose fetch
  //   failed this round — keep their previously cached in-range events instead
  //   of wiping them.
  const mergeEvents = useCallback((newEvents, startDate, endDate, keepEmails) => {
    setEventsState((prev) => {
      const newIds = new Set(newEvents.map((e) => e.id));
      const kept = prev.filter((e) => {
        if (newIds.has(e.id)) return false; // re-fetched — replaced by the new copy
        const d = e.start.substring(0, 10);
        if (d < startDate || d > endDate) return true; // outside synced range
        return keepEmails ? keepEmails.has((e.memberEmail || '').toLowerCase()) : false;
      });
      return [...kept, ...newEvents];
    });
    setLastSynced(new Date().toISOString());
    setSyncError(null);
  }, []);

  // Clear all events
  const clearEvents = useCallback(() => {
    setEventsState([]);
    setLastSynced(null);
    setSyncError(null);
  }, []);

  // Get events for a specific member email
  const getEventsForMember = useCallback(
    (email) => {
      return events.filter(
        (e) => e.memberEmail === email.toLowerCase()
      );
    },
    [events]
  );

  // Get events for a specific date (YYYY-MM-DD)
  const getEventsForDate = useCallback(
    (date) => {
      const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
      return events.filter((e) => {
        const eventDate = e.start.substring(0, 10);
        return eventDate === dateStr;
      });
    },
    [events]
  );

  const value = {
    events,
    loading,
    lastSynced,
    syncError,
    setEvents,
    addEvents,
    mergeEvents,
    clearEvents,
    getEventsForMember,
    getEventsForDate,
    setLoading,
    setSyncError,
  };

  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
}
