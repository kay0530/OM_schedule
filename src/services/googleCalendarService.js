/**
 * Google Calendar API (v3) service for member 瀬戸.
 *
 * Mirrors graphCalendarService.js: it returns the SAME { success, data, error }
 * contract and maps events into the SAME internal event shape, so the rest of
 * the app treats Google-sourced events identically to Outlook ones. CORS is
 * supported by the Google Calendar JSON API, so this runs directly in the
 * browser with the operator's GIS access token (no proxy).
 *
 * Read lives here now; create/update/delete are added in the write phase.
 */

const GCAL_BASE_URL = 'https://www.googleapis.com/calendar/v3';

/**
 * Convert a Google RFC3339 dateTime (carrying an offset) to a bare JST
 * wall-clock ISO string 'YYYY-MM-DDTHH:mm:ss'. The rest of the app slices
 * date/time with substring() and assumes naive local (JST) strings — exactly
 * what the Outlook path produces via the `Prefer: outlook.timezone="Asia/Tokyo"`
 * header — so normalize Google's offset-bearing values to match.
 * @param {string} rfc3339
 * @returns {string}
 */
function toJstBareIso(rfc3339) {
  if (!rfc3339) return '';
  const d = new Date(rfc3339);
  if (Number.isNaN(d.getTime())) return rfc3339.substring(0, 19);
  // 'sv-SE' formats as 'YYYY-MM-DD HH:mm:ss' in the requested time zone.
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
  return s.replace(' ', 'T');
}

/**
 * Transform a Google Calendar event into the app's internal event shape.
 * memberKey/memberEmail come from the routed member (always 瀬戸 here), NOT from
 * any email map — his app email is a personal gmail.
 * @param {Object} gEvent - Raw Google Calendar event
 * @param {{id:string, email:string}} member
 * @returns {Object}
 */
function transformGoogleEvent(gEvent, member) {
  const isAllDay = Boolean(gEvent.start?.date);
  // All-day: Google supplies start.date and an EXCLUSIVE end.date (next day);
  // keep that exclusive end so the views' `date >= start && date < end` logic
  // matches the Outlook all-day reads.
  const start = isAllDay
    ? `${gEvent.start.date}T00:00:00`
    : toJstBareIso(gEvent.start?.dateTime);
  const end = isAllDay
    ? `${gEvent.end?.date || gEvent.start.date}T00:00:00`
    : toJstBareIso(gEvent.end?.dateTime);
  return {
    id: gEvent.id,
    memberKey: member.id,
    memberEmail: (member.email || '').toLowerCase(),
    title: gEvent.summary || '(no title)',
    start,
    end,
    isAllDay,
    isBusy: gEvent.transparency !== 'transparent',
    location: gEvent.location || '',
    organizerName: gEvent.organizer?.displayName || '',
    organizerEmail: gEvent.organizer?.email || '',
    attendees: (gEvent.attendees || []).map((a) => ({
      name: a.displayName || '',
      email: a.email || '',
      type: a.optional ? 'optional' : 'required',
      response: a.responseStatus || 'none',
    })),
  };
}

/**
 * Authenticated GET against the Google Calendar API.
 * @param {string} url
 * @param {string} accessToken
 * @returns {Promise<Object>}
 */
async function gcalGet(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Calendar API error ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Fetch events for one member's Google calendar within [startDate, endDate].
 * Recurring events are expanded (singleEvents=true), matching Outlook's
 * calendarView behavior. Paginates via nextPageToken.
 * @param {string} accessToken - GIS access token
 * @param {{id:string, email:string, googleCalendarId?:string}} member
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 * @returns {Promise<{success:boolean, data:Array, error:string|null}>}
 */
export async function fetchGoogleCalendarEvents(accessToken, member, startDate, endDate) {
  const calendarId = member.googleCalendarId || member.email;
  const timeMin = `${startDate}T00:00:00+09:00`;
  const timeMax = `${endDate}T23:59:59+09:00`;
  const data = [];
  try {
    let pageToken = '';
    do {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
        timeZone: 'Asia/Tokyo',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const json = await gcalGet(
        `${GCAL_BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        accessToken
      );
      for (const item of json.items || []) {
        if (item.status === 'cancelled') continue;
        data.push(transformGoogleEvent(item, member));
      }
      pageToken = json.nextPageToken || '';
    } while (pageToken);
    return { success: true, data, error: null };
  } catch (err) {
    return { success: false, data, error: err.message };
  }
}
