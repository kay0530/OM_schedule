/**
 * Provider-agnostic calendar write router.
 *
 * The app writes schedule entries to each member's remote calendar. Most members
 * are on Outlook (Microsoft Graph); member 瀬戸 is on Google. This module is the
 * SINGLE place that branches by `member.calendarProvider`, so the call sites
 * (AssignModal / QuickAddModal / EventDetailModal / App delete) don't each
 * re-implement the if/else and drift apart.
 *
 * Every function takes a `tokens` object { outlook, google } of already-acquired
 * access tokens and returns the same { success, data, error } contract both
 * underlying services use. eventData is the app's MS365-shaped body; for Google
 * it is translated via buildGoogleEventBody.
 */
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from './graphCalendarService';
import {
  insertGoogleEvent,
  patchGoogleEvent,
  removeGoogleEvent,
  buildGoogleEventBody,
} from './googleCalendarService';

/** 'google' | 'outlook' — defaults to outlook when unset. */
export function memberProvider(member) {
  return member?.calendarProvider === 'google' ? 'google' : 'outlook';
}

/** The assignment field that holds this member's remote event id. */
export function remoteIdField(member) {
  return memberProvider(member) === 'google' ? 'googleEventId' : 'outlookEventId';
}

/** Read the remote event id off an assignment/object for this member's provider. */
export function remoteEventId(member, obj) {
  return obj?.[remoteIdField(member)] || null;
}

/** Whether this member's entries should be pushed to a remote calendar at all. */
export function shouldWriteRemote(member) {
  if (!member) return false;
  if (memberProvider(member) === 'google') return true;
  return !member.skipOutlookSync;
}

/** The calendar addressing key (email for Outlook, calendarId for Google). */
function addressKey(member) {
  return memberProvider(member) === 'google'
    ? member.googleCalendarId || member.email
    : member.email;
}

export async function createRemoteEvent(member, tokens, eventData) {
  if (memberProvider(member) === 'google') {
    if (!tokens.google) return { success: false, data: null, error: 'Google未連携' };
    return insertGoogleEvent(tokens.google, addressKey(member), buildGoogleEventBody(eventData));
  }
  if (!tokens.outlook) return { success: false, data: null, error: 'MS365トークンなし' };
  return createCalendarEvent(tokens.outlook, addressKey(member), eventData);
}

export async function updateRemoteEvent(member, tokens, remoteId, eventData) {
  if (memberProvider(member) === 'google') {
    if (!tokens.google) return { success: false, data: null, error: 'Google未連携' };
    return patchGoogleEvent(tokens.google, addressKey(member), remoteId, buildGoogleEventBody(eventData));
  }
  if (!tokens.outlook) return { success: false, data: null, error: 'MS365トークンなし' };
  return updateCalendarEvent(tokens.outlook, addressKey(member), remoteId, eventData);
}

export async function deleteRemoteEvent(member, tokens, remoteId) {
  if (memberProvider(member) === 'google') {
    if (!tokens.google) return { success: false, data: null, error: 'Google未連携' };
    return removeGoogleEvent(tokens.google, addressKey(member), remoteId);
  }
  if (!tokens.outlook) return { success: false, data: null, error: 'MS365トークンなし' };
  return deleteCalendarEvent(tokens.outlook, addressKey(member), remoteId);
}
