const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

const SELECT_FIELDS = 'subject,start,end,isAllDay,showAs,location,organizer,attendees';

/** Fields for the work-report export — includes the event body. */
const REPORT_SELECT = 'subject,start,end,location,body';

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
  'nstandard.info@gmail.com': 'seto_r',
  'shoichiro.tago@altenergy.co.jp': 'tago_s',
};

/**
 * Convert a failed Graph response into a short, user-readable Japanese error.
 * The thrown message surfaces in modal error boxes / alerts, so it must not be
 * a raw JSON blob. The full body is logged to the console for debugging.
 * @param {number} status - HTTP status code
 * @param {string} errorBody - Raw response body text
 * @returns {Error}
 */
function humanizeGraphError(status, errorBody) {
  let code = '';
  let detail = errorBody;
  try {
    const parsed = JSON.parse(errorBody);
    code = parsed.error?.code || '';
    detail = parsed.error?.message || errorBody;
  } catch { /* body was not JSON — keep raw text */ }
  console.error(`[Graph] HTTP ${status} ${code}: ${detail}`);

  let message;
  if (status === 401 || code === 'InvalidAuthenticationToken') {
    message = 'MS365の認証が切れています。再ログインしてください';
  } else if (status === 403 || code === 'ErrorAccessDenied') {
    message = 'このカレンダーを操作する権限がありません';
  } else if (status === 404) {
    message = '対象の予定またはカレンダーが見つかりません';
  } else if (status === 429) {
    message = 'Outlookへのアクセスが混み合っています。しばらく待ってから再試行してください';
  } else if (status >= 500) {
    message = 'Microsoft側で一時的なエラーが発生しました。しばらく待ってから再試行してください';
  } else if (status === 400 || code === 'ErrorInvalidRequest') {
    message = '予定の内容をOutlookが受け付けませんでした（日時の指定などを確認してください）';
  } else {
    message = 'Outlookとの通信でエラーが発生しました';
  }
  return new Error(`${message} (HTTP ${status})`);
}

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
    throw humanizeGraphError(res.status, await res.text());
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
    throw humanizeGraphError(res.status, await res.text());
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
 * Authenticated GET that asks Graph to return event bodies as PLAIN TEXT
 * (outlook.body-content-type="text"), so the work-report template can be parsed
 * line-by-line without stripping HTML.
 */
async function graphGetTextBody(url, accessToken) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="Asia/Tokyo", outlook.body-content-type="text"',
    },
  });
  if (!res.ok) {
    throw humanizeGraphError(res.status, await res.text());
  }
  return res.json();
}

/**
 * Fetch a member's calendar events WITH their plain-text body, for the
 * work-report export. Kept separate from fetchMemberCalendarEvents (which omits
 * the body to keep the regular sync light).
 * @returns {Promise<{success:boolean, data:Array<{id,subject,start,end,location,bodyText,memberEmail}>, error:string|null}>}
 */
export async function fetchMemberEventsWithBody(accessToken, memberEmail, startDate, endDate) {
  try {
    const startDateTime = `${startDate}T00:00:00`;
    const endDateTime = `${endDate}T23:59:59`;
    const params = new URLSearchParams({
      startDateTime,
      endDateTime,
      $select: REPORT_SELECT,
      $top: '500',
    });

    let url = `${GRAPH_BASE_URL}/users/${memberEmail}/calendarView?${params}`;
    const data = [];

    while (url) {
      const json = await graphGetTextBody(url, accessToken);
      for (const e of json.value || []) {
        data.push({
          id: e.id,
          subject: e.subject || '',
          start: e.start?.dateTime || '',
          end: e.end?.dateTime || '',
          location: e.location?.displayName || '',
          bodyText: e.body?.content || '',
          memberEmail,
        });
      }
      url = json['@odata.nextLink'] || null;
    }

    return { success: true, data, error: null };
  } catch (err) {
    console.error(`Failed to fetch report events for ${memberEmail}:`, err);
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
    members.map((m) => m.sharedCalendarOwner
      ? fetchSharedCalendarEvents(accessToken, m, startDate, endDate)
      : fetchMemberCalendarEvents(accessToken, m.outlookEmail || m.email, startDate, endDate))
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
      errors.push({ member: members[i].outlookEmail || members[i].email, error: errorMsg });
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
/**
 * Make an authenticated PATCH request to Microsoft Graph API.
 * @param {string} url
 * @param {string} accessToken
 * @param {Object} body
 * @returns {Promise<Object>}
 */
async function graphPatch(url, accessToken, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw humanizeGraphError(res.status, await res.text());
  }
  return res.json();
}

/**
 * Make an authenticated DELETE request to Microsoft Graph API.
 * @param {string} url
 * @param {string} accessToken
 * @returns {Promise<void>}
 */
async function graphDelete(url, accessToken) {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  // 404 = the event is already gone on Outlook side. Treat as success so we
  // don't pollute the console when re-deleting an event that was already
  // removed from Outlook directly or by another peer.
  if (res.status === 404) return { alreadyGone: true };
  if (!res.ok) {
    throw humanizeGraphError(res.status, await res.text());
  }
  return { alreadyGone: false };
}

/**
 * Update a calendar event for a member.
 * @param {string} accessToken
 * @param {string} memberEmail
 * @param {string} eventId
 * @param {Object} updates - { subject, start: { dateTime, timeZone }, end: { dateTime, timeZone } }
 * @returns {Promise<{success:boolean, data:Object|null, error:string|null}>}
 */
export async function updateCalendarEvent(accessToken, memberEmail, eventId, updates) {
  try {
    const url = `${GRAPH_BASE_URL}/users/${memberEmail}/events/${eventId}`;
    const data = await graphPatch(url, accessToken, updates);
    return { success: true, data, error: null };
  } catch (err) {
    console.error(`Failed to update event ${eventId} for ${memberEmail}:`, err);
    return { success: false, data: null, error: err.message };
  }
}

/**
 * Delete a calendar event for a member.
 * @param {string} accessToken
 * @param {string} memberEmail
 * @param {string} eventId
 * @returns {Promise<{success:boolean, error:string|null}>}
 */
export async function deleteCalendarEvent(accessToken, memberEmail, eventId) {
  try {
    const url = `${GRAPH_BASE_URL}/users/${memberEmail}/events/${eventId}`;
    const r = await graphDelete(url, accessToken);
    return { success: true, error: null, alreadyGone: !!r?.alreadyGone };
  } catch (err) {
    // 404 is handled inside graphDelete; everything else is a real failure.
    console.error(`Failed to delete event ${eventId} for ${memberEmail}:`, err);
    return { success: false, error: err.message };
  }
}

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

// ========== Shared calendar (member 瀬戸) ==========
// 瀬戸 is not a tenant user; his schedule lives on a personal-account calendar
// that the operator has added to their own Outlook (canEdit). It is addressed by
// the operator's LOCAL calendar id — resolved at runtime from the owner address,
// since the id differs per operator mailbox. Events are ordinary Outlook events,
// so callers store their ids in the usual `outlookEventId` and the existing
// reconcile / dedup / chip logic works unchanged.

const sharedCalendarIdCache = new Map(); // ownerAddress(lowercase) -> calendarId

async function resolveSharedCalendarId(accessToken, ownerAddress) {
  const key = (ownerAddress || '').toLowerCase();
  if (!key) return null;
  if (sharedCalendarIdCache.has(key)) return sharedCalendarIdCache.get(key);
  const data = await graphGet(`${GRAPH_BASE_URL}/me/calendars?$select=id,owner&$top=200`, accessToken);
  const match = (data.value || []).find((c) => (c.owner?.address || '').toLowerCase() === key);
  const id = match?.id || null;
  if (id) sharedCalendarIdCache.set(key, id);
  return id;
}

/**
 * Fetch events from a member's shared calendar (matched by owner address).
 * Same {success,data,error} shape and internal event shape as
 * fetchMemberCalendarEvents.
 */
export async function fetchSharedCalendarEvents(accessToken, member, startDate, endDate) {
  try {
    const calId = await resolveSharedCalendarId(accessToken, member.sharedCalendarOwner);
    if (!calId) {
      return { success: false, data: [], error: `${member.nameJa}の共有カレンダーが見つかりません（Outlookに追加してください）` };
    }
    const startDateTime = `${startDate}T00:00:00`;
    const endDateTime = `${endDate}T23:59:59`;
    const params = new URLSearchParams({ startDateTime, endDateTime, $select: SELECT_FIELDS, $top: '500' });
    let url = `${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calId)}/calendarView?${params}`;
    const allEvents = [];
    while (url) {
      const data = await graphGet(url, accessToken);
      const events = data.value || [];
      allEvents.push(...events.map((e) => transformEvent(e, member.email)));
      url = data['@odata.nextLink'] || null;
    }
    return { success: true, data: allEvents, error: null };
  } catch (err) {
    console.error(`Failed to fetch shared calendar for ${member.nameJa}:`, err);
    return { success: false, data: [], error: err.message };
  }
}

// ---- Member-aware write wrappers: route sharedCalendarOwner members to the
//      shared-calendar endpoint, everyone else to /users/{email}. ----

export async function createEventForMember(accessToken, member, eventData) {
  if (member?.sharedCalendarOwner) {
    try {
      const calId = await resolveSharedCalendarId(accessToken, member.sharedCalendarOwner);
      if (!calId) return { success: false, data: null, error: `${member.nameJa}の共有カレンダーが見つかりません` };
      const data = await graphPost(`${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calId)}/events`, accessToken, eventData);
      return { success: true, data, error: null };
    } catch (err) {
      return { success: false, data: null, error: err.message };
    }
  }
  return createCalendarEvent(accessToken, member.email, eventData);
}

export async function updateEventForMember(accessToken, member, eventId, updates) {
  if (member?.sharedCalendarOwner) {
    try {
      const calId = await resolveSharedCalendarId(accessToken, member.sharedCalendarOwner);
      if (!calId) return { success: false, data: null, error: `${member.nameJa}の共有カレンダーが見つかりません` };
      const data = await graphPatch(`${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calId)}/events/${eventId}`, accessToken, updates);
      return { success: true, data, error: null };
    } catch (err) {
      return { success: false, data: null, error: err.message };
    }
  }
  return updateCalendarEvent(accessToken, member.email, eventId, updates);
}

/**
 * Fetch a single event (subject / plain-text body / location) for a member.
 * Used to carry the original content over when a cross-member move re-creates
 * the event on another calendar — the body holds the crew's 作業報告 text
 * that the 活動報告 export parses, which must not be lost.
 */
export async function fetchEventForMember(accessToken, member, eventId) {
  const select = '$select=subject,body,location';
  try {
    if (member?.sharedCalendarOwner) {
      const calId = await resolveSharedCalendarId(accessToken, member.sharedCalendarOwner);
      if (!calId) return { success: false, data: null, error: `${member.nameJa}の共有カレンダーが見つかりません` };
      const data = await graphGetTextBody(`${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calId)}/events/${eventId}?${select}`, accessToken);
      return { success: true, data, error: null };
    }
    const data = await graphGetTextBody(`${GRAPH_BASE_URL}/users/${member.email}/events/${eventId}?${select}`, accessToken);
    return { success: true, data, error: null };
  } catch (err) {
    return { success: false, data: null, error: err.message };
  }
}

export async function deleteEventForMember(accessToken, member, eventId) {
  if (member?.sharedCalendarOwner) {
    try {
      const calId = await resolveSharedCalendarId(accessToken, member.sharedCalendarOwner);
      if (!calId) return { success: false, error: `${member.nameJa}の共有カレンダーが見つかりません` };
      const r = await graphDelete(`${GRAPH_BASE_URL}/me/calendars/${encodeURIComponent(calId)}/events/${eventId}`, accessToken);
      return { success: true, error: null, alreadyGone: !!r?.alreadyGone };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return deleteCalendarEvent(accessToken, member.email, eventId);
}
