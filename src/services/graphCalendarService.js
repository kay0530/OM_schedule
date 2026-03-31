const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

const SELECT_FIELDS = 'subject,start,end,isAllDay,showAs,location,organizer,attendees';

/** Map member emails to internal member keys */
const MEMBER_EMAIL_MAP = {
  'norifumi.hiroki@altenergy.co.jp': 'hiroki_n',
  'takahiro.ota@altenergy.co.jp': 'ota_t',
  'kazuhiro.sasanuma@altenergy.co.jp': 'sasanuma_k',
  'hayato.tano@altenergy.co.jp': 'tano_h',
  'tatsuto.wano@altenergy.co.jp': 'wano_t',
  'kaito.yamazaki@altenergy.co.jp': 'yamazaki_k',
  'jigjidsuren.bold@altenergy.co.jp': 'bold_j',
  'taichi.yodogawa@altenergy.co.jp': 'yodogawa_t',
  'ryota.seto@altenergy.co.jp': 'seto_r',
  'shoichiro.tago@altenergy.co.jp': 'tago_s',
};

/**
 * Make an authenticated GET request to Microsoft Graph API.
 * @param {string} url
 * @param {string} accessToken
 * @returns {Promise<Object>}
 */
async function graphGet(url, accessToken) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="Asia/Tokyo"',
    },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Graph API error ${res.status}: ${errorBody}`);
  }
  return res.json();
}

/**
 * Make an authenticated POST request to Microsoft Graph API.
 * @param {string} url
 * @param {string} accessToken
 * @param {Object} body
 * @returns {Promise<Object>}
 */
async function graphPost(url, accessToken, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Graph API error ${res.status}: ${errorBody}`);
  }
  return res.json();
}

/**
 * Transform a Graph API event into the app's internal event format.
 * @param {Object} event - Raw Graph API event
 * @param {string} memberEmail - The member's email address
 * @returns {Object} Internal event object
 */
function transformEvent(event, memberEmail) {
  const emailLower = memberEmail.toLowerCase();
  return {
    id: event.id,
    memberKey: MEMBER_EMAIL_MAP[emailLower] || emailLower,
    memberEmail: emailLower,
    title: event.subject || '(no title)',
    start: event.start?.dateTime || '',
    end: event.end?.dateTime || '',
    isAllDay: Boolean(event.isAllDay),
    isBusy: event.showAs !== 'free',
    location: event.location?.displayName || '',
    organizerName: event.organizer?.emailAddress?.name || '',
    organizerEmail: event.organizer?.emailAddress?.address || '',
    attendees: event.attendees?.map((a) => ({
      name: a.emailAddress.name,
      email: a.emailAddress.address,
      type: a.type,
      response: a.status?.response || 'none',
    })) || [],
  };
}

/**
 * Fetch calendar events for a single member within a date range.
 * Handles pagination via @odata.nextLink.
 * @param {string} accessToken
 * @param {string} memberEmail
 * @param {string} startDate - ISO date string (e.g. '2026-03-01')
 * @param {string} endDate - ISO date string (e.g. '2026-03-31')
 * @returns {Promise<{success:boolean, data:Array, error:string|null}>}
 */
export async function fetchMemberCalendarEvents(accessToken, memberEmail, startDate, endDate) {
  try {
    const startDateTime = `${startDate}T00:00:00`;
    const endDateTime = `${endDate}T23:59:59`;
    const params = new URLSearchParams({
      startDateTime,
      endDateTime,
      $select: SELECT_FIELDS,
      $top: '500',
    });

    let url = `${GRAPH_BASE_URL}/users/${memberEmail}/calendarView?${params}`;
    const allEvents = [];

    while (url) {
      const data = await graphGet(url, accessToken);
      const events = data.value || [];
      allEvents.push(...events.map((e) => transformEvent(e, memberEmail)));
      url = data['@odata.nextLink'] || null;
    }

    return { success: true, data: allEvents, error: null };
  } catch (err) {
    console.error(`Failed to fetch calendar for ${memberEmail}:`, err);
    return { success: false, data: [], error: err.message };
  }
}

/**
 * Fetch calendar events for all members.
 * Uses Promise.allSettled for resilience — partial failures don't block other results.
 * @param {string} accessToken
 * @param {Array<{outlookEmail:string}>} members - Members from AppContext
 * @param {string} startDate
 * @param {string} endDate
 * @returns {Promise<{success:boolean, data:Array, errors:Array}>}
 */
export async function fetchAllMembersCalendarEvents(accessToken, members, startDate, endDate) {
  const results = await Promise.allSettled(
    members.map((m) => fetchMemberCalendarEvents(accessToken, m.outlookEmail, startDate, endDate))
  );

  const allEvents = [];
  const errors = [];

  results.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value.success) {
      allEvents.push(...result.value.data);
    } else {
      const errorMsg = result.status === 'fulfilled'
        ? result.value.error
        : result.reason?.message || 'Unknown error';
      errors.push({ member: members[i].outlookEmail, error: errorMsg });
    }
  });

  return {
    success: errors.length === 0,
    data: allEvents,
    errors,
  };
}

/**
 * Create a calendar event for a member.
 * @param {string} accessToken
 * @param {string} memberEmail
 * @param {Object} eventData - MS365-compatible event body
 * @returns {Promise<{success:boolean, data:Object|null, error:string|null}>}
 */
export async function createCalendarEvent(accessToken, memberEmail, eventData) {
  try {
    const url = `${GRAPH_BASE_URL}/users/${memberEmail}/events`;
    const data = await graphPost(url, accessToken, eventData);
    return { success: true, data, error: null };
  } catch (err) {
    console.error(`Failed to create event for ${memberEmail}:`, err);
    return { success: false, data: null, error: err.message };
  }
}
