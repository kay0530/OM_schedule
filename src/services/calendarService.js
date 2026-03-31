import {
  timeStringToMinutes,
  minutesToTimeString,
  toISODate,
} from '../utils/dateUtils';

/**
 * Parse MS365 calendar events into internal format.
 * @param {Array} outlookEvents - Raw events from MS365 API
 * @returns {Array<{id:string, title:string, start:string, end:string, memberEmail:string, isAllDay:boolean, isBusy:boolean}>}
 */
export function parseCalendarEvents(outlookEvents) {
  if (!Array.isArray(outlookEvents)) return [];

  return outlookEvents.map((event) => {
    const showAs = (event.showAs || 'busy').toLowerCase();
    const isBusy = showAs !== 'free';

    return {
      id: event.id || event.iCalUId || crypto.randomUUID(),
      title: event.subject || '(no title)',
      start: event.start?.dateTime
        ? normalizeDateTime(event.start.dateTime, event.start.timeZone)
        : '',
      end: event.end?.dateTime
        ? normalizeDateTime(event.end.dateTime, event.end.timeZone)
        : '',
      memberEmail: extractOrganizerEmail(event),
      isAllDay: Boolean(event.isAllDay),
      isBusy,
    };
  });
}

/**
 * Normalize a datetime string. If it has no timezone info, treat as-is.
 * @param {string} dt - dateTime string from MS365
 * @param {string} tz - timeZone name
 * @returns {string} ISO datetime string
 */
function normalizeDateTime(dt) {
  // MS365 often returns datetime without offset; keep as-is for local usage
  if (dt && !dt.endsWith('Z') && !dt.includes('+') && !dt.includes('-', 10)) {
    return dt;
  }
  return dt;
}

/**
 * Extract the organizer or attendee email from an event.
 * @param {Object} event
 * @returns {string}
 */
function extractOrganizerEmail(event) {
  if (event.organizer?.emailAddress?.address) {
    return event.organizer.emailAddress.address.toLowerCase();
  }
  if (event.attendees?.length > 0) {
    return (event.attendees[0].emailAddress?.address || '').toLowerCase();
  }
  return '';
}

/**
 * Find available time slots for a member on a given date.
 * @param {string} memberEmail
 * @param {Array} events - Internal format events
 * @param {string|Date} date - Target date
 * @param {{start:string, end:string}} workingHours - e.g. { start:'09:00', end:'18:00' }
 * @returns {Array<{start:string, end:string, durationMinutes:number}>}
 */
export function findAvailableSlots(memberEmail, events, date, workingHours) {
  const dateStr = typeof date === 'string' ? date : toISODate(date);
  const dayStart = timeStringToMinutes(workingHours.start);
  const dayEnd = timeStringToMinutes(workingHours.end);

  // Filter busy events for this member on this date
  const busySlots = events
    .filter((e) => {
      if (e.memberEmail?.toLowerCase() !== memberEmail.toLowerCase()) return false;
      if (!e.isBusy) return false;
      const eventDate = e.start.substring(0, 10);
      return eventDate === dateStr;
    })
    .map((e) => {
      const startMin = e.isAllDay
        ? dayStart
        : timeStringToMinutes(e.start.substring(11, 16));
      const endMin = e.isAllDay
        ? dayEnd
        : timeStringToMinutes(e.end.substring(11, 16));
      return {
        start: Math.max(startMin, dayStart),
        end: Math.min(endMin, dayEnd),
      };
    })
    .filter((s) => s.start < s.end)
    .sort((a, b) => a.start - b.start);

  // Merge overlapping busy slots
  const merged = [];
  for (const slot of busySlots) {
    if (merged.length === 0 || merged[merged.length - 1].end < slot.start) {
      merged.push({ ...slot });
    } else {
      merged[merged.length - 1].end = Math.max(
        merged[merged.length - 1].end,
        slot.end
      );
    }
  }

  // Compute free slots
  const freeSlots = [];
  let cursor = dayStart;

  for (const busy of merged) {
    if (cursor < busy.start) {
      freeSlots.push({
        start: minutesToTimeString(cursor),
        end: minutesToTimeString(busy.start),
        durationMinutes: busy.start - cursor,
      });
    }
    cursor = Math.max(cursor, busy.end);
  }

  if (cursor < dayEnd) {
    freeSlots.push({
      start: minutesToTimeString(cursor),
      end: minutesToTimeString(dayEnd),
      durationMinutes: dayEnd - cursor,
    });
  }

  return freeSlots;
}

/**
 * Check if all specified team members are available in a given time range.
 * @param {string[]} memberEmails
 * @param {Array} events - Internal format events
 * @param {string|Date} date
 * @param {string} startTime - HH:MM
 * @param {string} endTime - HH:MM
 * @returns {{allAvailable:boolean, unavailableMembers:string[], conflictingEvents:Array}}
 */
export function checkTeamAvailability(
  memberEmails,
  events,
  date,
  startTime,
  endTime
) {
  const dateStr = typeof date === 'string' ? date : toISODate(date);
  const rangeStart = timeStringToMinutes(startTime);
  const rangeEnd = timeStringToMinutes(endTime);

  const unavailableMembers = [];
  const conflictingEvents = [];

  for (const email of memberEmails) {
    const memberEvents = events.filter((e) => {
      if (e.memberEmail !== email.toLowerCase()) return false;
      if (!e.isBusy) return false;
      const eventDate = e.start.substring(0, 10);
      return eventDate === dateStr;
    });

    for (const evt of memberEvents) {
      const evtStart = evt.isAllDay
        ? 0
        : timeStringToMinutes(evt.start.substring(11, 16));
      const evtEnd = evt.isAllDay
        ? 1440
        : timeStringToMinutes(evt.end.substring(11, 16));

      // Check for overlap
      if (evtStart < rangeEnd && evtEnd > rangeStart) {
        if (!unavailableMembers.includes(email)) {
          unavailableMembers.push(email);
        }
        conflictingEvents.push({
          ...evt,
          memberEmail: email,
        });
      }
    }
  }

  return {
    allAvailable: unavailableMembers.length === 0,
    unavailableMembers,
    conflictingEvents,
  };
}

/**
 * Search preferred date +/- daysRange for dates with best team availability.
 * @param {string[]} memberEmails
 * @param {Array} events - Internal format events
 * @param {string|Date} preferredDate
 * @param {number} daysRange - Number of days before/after to search
 * @param {{start:string, end:string}} workingHours
 * @returns {Array<{date:string, availableCount:number, totalMembers:number, availableMembers:string[]}>}
 */
export function findBestDates(
  memberEmails,
  events,
  preferredDate,
  daysRange = 3,
  workingHours
) {
  const baseDate = new Date(preferredDate);
  const results = [];

  for (let offset = -daysRange; offset <= daysRange; offset++) {
    const checkDate = new Date(baseDate);
    checkDate.setDate(baseDate.getDate() + offset);
    const dateStr = toISODate(checkDate);

    // Skip weekends
    const dayOfWeek = checkDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const availableMembers = [];

    for (const email of memberEmails) {
      const slots = findAvailableSlots(email, events, dateStr, workingHours);
      // Consider available if they have at least 2 hours free
      const totalFree = slots.reduce((sum, s) => sum + s.durationMinutes, 0);
      if (totalFree >= 120) {
        availableMembers.push(email);
      }
    }

    results.push({
      date: dateStr,
      availableCount: availableMembers.length,
      totalMembers: memberEmails.length,
      availableMembers,
    });
  }

  // Sort by available count descending, then by proximity to preferred date
  results.sort((a, b) => {
    if (b.availableCount !== a.availableCount) {
      return b.availableCount - a.availableCount;
    }
    const diffA = Math.abs(
      new Date(a.date).getTime() - baseDate.getTime()
    );
    const diffB = Math.abs(
      new Date(b.date).getTime() - baseDate.getTime()
    );
    return diffA - diffB;
  });

  return results;
}

/**
 * Create an MS365-compatible event object for creating calendar events.
 * @param {Object} assignment - Assignment object
 * @param {Object} job - Job object
 * @param {Array} members - Array of member objects assigned
 * @returns {Object} MS365-compatible event body
 */
export function formatEventForOutlook(assignment, job, members) {
  const bodyContent = [
    `案件: ${job.title}`,
    `場所: ${job.locationName}`,
    `住所: ${job.locationAddress}`,
    ``,
    `チームメンバー:`,
    ...members.map(
      (m) =>
        `  - ${m.nameJa}${m.id === assignment.leadMemberId ? ' (リーダー)' : ''}`
    ),
    ``,
    `推定作業時間: ${job.estimatedTimeHours}時間`,
    job.notes ? `備考: ${job.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    subject: `[工事] ${job.title}`,
    body: {
      contentType: 'text',
      content: bodyContent,
    },
    start: {
      dateTime: assignment.scheduledArrival || job.scheduledStart,
      timeZone: 'Asia/Tokyo',
    },
    end: {
      dateTime: job.scheduledEnd || calculateEndTime(assignment.scheduledArrival || job.scheduledStart, job.estimatedTimeHours),
      timeZone: 'Asia/Tokyo',
    },
    location: {
      displayName: job.locationName,
      address: {
        street: job.locationAddress,
      },
    },
    attendees: members.map((m) => ({
      emailAddress: {
        address: m.outlookEmail,
        name: m.nameJa,
      },
      type: m.id === assignment.leadMemberId ? 'required' : 'optional',
    })),
    isOnlineMeeting: false,
  };
}

/**
 * Calculate end time by adding hours to a start datetime string.
 * @param {string} startDateTime - ISO datetime string
 * @param {number} hours
 * @returns {string} ISO datetime string
 */
function calculateEndTime(startDateTime, hours) {
  const d = new Date(startDateTime);
  d.setMinutes(d.getMinutes() + Math.round(hours * 60));
  return d.toISOString();
}
