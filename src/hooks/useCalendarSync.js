import { useState, useCallback, useRef } from 'react';
import { useCalendar } from '../context/CalendarContext';
import { parseCalendarEvents } from '../services/calendarService';
import { fetchAllMembersCalendarEvents } from '../services/graphCalendarService';
import { toISODate } from '../utils/dateUtils';

/**
 * Hook for syncing calendar data with Outlook via Graph API or manual imports.
 *
 * Provides:
 * - syncFromOutlook: Fetch live calendar data from Graph API
 * - importCalendarData: Accept externally provided MS365 data
 * - autoSync: Try Graph API with token, fall back gracefully
 * - fetchWeekData: Fetch a specific week from Graph API
 * - syncStatus: Object tracking sync progress
 */
export function useCalendarSync() {
  const { setEvents, addEvents, mergeEvents, setLoading, setSyncError } =
    useCalendar();
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState({
    syncing: false,
    lastSync: null,
    error: null,
    syncedMembers: 0,
    totalMembers: 0,
  });

  // Ref to prevent concurrent syncs
  const syncInProgressRef = useRef(false);

  /**
   * Accept pasted or imported calendar data and parse it.
   * Useful when Claude MCP fetches MS365 data and passes it back.
   *
   * @param {Array} data - Raw MS365 event data (with 'subject' field) or pre-parsed events
   */
  const importCalendarData = useCallback(
    (data) => {
      try {
        // If data looks like MS365 format (has 'subject' field), parse it
        const hasSubject = data.length > 0 && data[0].subject !== undefined;
        const parsed = hasSubject ? parseCalendarEvents(data) : data;
        addEvents(parsed);
        const now = new Date().toISOString();
        setLastSync(now);
        setError(null);

        setSyncStatus((prev) => ({
          ...prev,
          lastSync: now,
          error: null,
        }));
      } catch (err) {
        const message = err.message || 'Import failed';
        setError(message);
        setSyncError(message);

        setSyncStatus((prev) => ({
          ...prev,
          error: message,
        }));
      }
    },
    [addEvents, setSyncError]
  );

  /**
   * Sync calendar events from Outlook via Graph API (live data).
   * Merges fetched events with existing data (replaces events within the fetched date range).
   *
   * @param {string} accessToken - MS365 access token from AuthContext.getToken()
   * @param {Array<{outlookEmail: string}>} members - Member objects with outlookEmail
   * @param {string|Date} startDate - Start of date range
   * @param {string|Date} endDate - End of date range
   * @returns {Promise<{success: boolean, count: number, error: string|null}>}
   */
  const syncFromOutlook = useCallback(
    async (accessToken, members, startDate, endDate) => {
      if (syncInProgressRef.current) {
        console.warn('[CalendarSync] Sync already in progress, skipping.');
        return { success: false, count: 0, error: 'Sync already in progress' };
      }

      syncInProgressRef.current = true;
      setSyncing(true);
      setLoading(true);
      setError(null);
      setSyncError(null);

      const totalMembers = members ? members.length : 0;

      setSyncStatus({
        syncing: true,
        lastSync: null,
        error: null,
        syncedMembers: 0,
        totalMembers,
      });

      try {
        const startStr = toISODate(new Date(startDate));
        const endStr = toISODate(new Date(endDate));

        console.log(
          '[CalendarSync] Live Outlook sync for',
          totalMembers,
          'members from',
          startStr,
          'to',
          endStr
        );

        const result = await fetchAllMembersCalendarEvents(
          accessToken,
          members,
          startStr,
          endStr
        );

        // Merge: keep events outside the synced range, replace events within it.
        // A fully successful fetch may legitimately be EMPTY (all events were
        // deleted on the Outlook side) — merge anyway so stale cached events
        // get cleared. On partial failure, keep the failed members' previously
        // cached events instead of blanking their columns.
        if (result.errors.length === 0) {
          mergeEvents(result.data, startStr, endStr);
        } else if (result.data.length > 0) {
          const failedEmails = new Set();
          for (const entry of result.errors) {
            // Match by member object so both email identities are covered
            // (events tag memberEmail as m.email for shared calendars but
            // m.outlookEmail || m.email for normal fetches)
            const m = (members || []).find(
              (mm) => ((mm.outlookEmail || mm.email) || '').toLowerCase() === String(entry.member || '').toLowerCase()
            );
            if (m) {
              if (m.email) failedEmails.add(m.email.toLowerCase());
              if (m.outlookEmail) failedEmails.add(m.outlookEmail.toLowerCase());
            } else if (entry.member) {
              failedEmails.add(String(entry.member).toLowerCase());
            }
          }
          mergeEvents(result.data, startStr, endStr, failedEmails);
        }

        const now = new Date().toISOString();
        setLastSync(now);

        // Count unique members that returned events
        const syncedEmailSet = new Set(
          result.data.map((e) => e.memberEmail.toLowerCase())
        );

        setSyncStatus({
          syncing: false,
          lastSync: now,
          error: result.errors.length > 0
            ? `${result.errors.length} member(s) failed`
            : null,
          syncedMembers: syncedEmailSet.size,
          totalMembers,
        });

        if (result.errors.length > 0) {
          console.warn('[CalendarSync] Partial sync errors:', result.errors);
        }

        console.log(
          '[CalendarSync] Live sync complete.',
          result.data.length,
          'events fetched.'
        );

        return {
          success: result.errors.length === 0,
          count: result.data.length,
          error: result.errors.length > 0
            ? `${result.errors.length}名の同期に失敗しました`
            : null,
          // Per-member detail ({member, error}) so callers can show WHO failed
          errors: result.errors,
        };
      } catch (err) {
        const message = err.message || 'Outlook sync failed';
        setError(message);
        setSyncError(message);

        setSyncStatus((prev) => ({
          ...prev,
          syncing: false,
          error: message,
        }));

        console.error('[CalendarSync] Live sync error:', message);
        return { success: false, count: 0, error: message };
      } finally {
        setSyncing(false);
        setLoading(false);
        syncInProgressRef.current = false;
      }
    },
    [mergeEvents, setLoading, setSyncError]
  );

  /**
   * Auto-sync: try Graph API with token, start with empty events on failure.
   * Range: today -14 days to +42 days.
   *
   * @param {() => Promise<string|null>} getToken - Async function that returns an access token or null
   * @param {Array<{outlookEmail: string}>} members - Member objects with outlookEmail
   * @returns {Promise<{source: 'outlook'|'empty', success: boolean, count?: number, error?: string}>}
   */
  const autoSync = useCallback(
    async (getToken, members) => {
      // Prevent concurrent syncs
      if (syncInProgressRef.current) {
        console.warn('[CalendarSync] autoSync: sync already in progress, skipping.');
        return { source: 'empty', success: false, error: 'Sync already in progress' };
      }

      // Compute date range: today -14 days to +42 days
      const today = new Date();
      const startDate = new Date(today);
      startDate.setDate(today.getDate() - 14);
      const endDate = new Date(today);
      endDate.setDate(today.getDate() + 42);

      try {
        const token = await getToken();

        if (token) {
          // Token available: sync from Outlook Graph API
          console.log('[CalendarSync] autoSync: token acquired, syncing from Outlook.');
          const result = await syncFromOutlook(token, members, startDate, endDate);
          return {
            source: 'outlook',
            success: result.success,
            count: result.count,
            error: result.error || undefined,
          };
        }
      } catch (err) {
        console.warn('[CalendarSync] autoSync: token acquisition failed.', err.message);
      }

      // No token available — start with empty state
      console.log('[CalendarSync] autoSync: no token, starting with empty calendar.');
      return {
        source: 'empty',
        success: true,
        count: 0,
      };
    },
    [syncFromOutlook]
  );

  /**
   * Fetch calendar data for a specific week from Graph API.
   * Uses syncFromOutlook internally (which merges events).
   *
   * @param {() => Promise<string>} getToken - Async function that returns an access token
   * @param {Array<{outlookEmail: string}>} members - Member objects with outlookEmail
   * @param {Date|string} weekStartDate - The start date of the week to fetch
   * @returns {Promise<{success: boolean, count?: number, error?: string}>}
   */
  const fetchWeekData = useCallback(
    async (getToken, members, weekStartDate) => {
      // Prevent concurrent syncs
      if (syncInProgressRef.current) {
        console.warn('[CalendarSync] fetchWeekData: sync already in progress, skipping.');
        return { success: false, error: 'Sync already in progress' };
      }

      try {
        const token = await getToken();
        const startDate = new Date(weekStartDate);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);

        console.log(
          '[CalendarSync] fetchWeekData: fetching week',
          toISODate(startDate),
          'to',
          toISODate(endDate)
        );

        const result = await syncFromOutlook(token, members, startDate, endDate);
        return {
          success: result.success,
          count: result.count,
          error: result.error || undefined,
        };
      } catch (err) {
        const message = err.message || 'fetchWeekData failed';
        console.error('[CalendarSync] fetchWeekData error:', message);
        return { success: false, error: message };
      }
    },
    [syncFromOutlook]
  );

  return {
    syncing,
    lastSync,
    error,
    syncStatus,
    importCalendarData,
    syncFromOutlook,
    autoSync,
    fetchWeekData,
  };
}
