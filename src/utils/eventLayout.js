import { timeStringToMinutes } from './dateUtils';

/**
 * Extract start/end minutes from a calendar event or assignment.
 */
function getRange(ev) {
  const startTime = ev.startTime || ev.start?.substring(11, 16);
  const endTime = ev.endTime || ev.end?.substring(11, 16);
  if (!startTime || !endTime) return null;
  return { start: timeStringToMinutes(startTime), end: timeStringToMinutes(endTime) };
}

/**
 * Compute per-event lane assignments so overlapping events can render
 * side-by-side instead of stacking on top of each other.
 *
 * Algorithm: sort by start time, place each event in the first lane whose
 * latest end-time is <= the event's start. The lane count is the global max
 * (all events in a date-cell share the same width slot) — simple but matches
 * Outlook's appearance for most schedules.
 *
 * @param {Array<object>} events
 * @returns {Array<{event:object, laneIndex:number, laneCount:number}>}
 */
export function layoutEvents(events) {
  if (!events || events.length === 0) return [];

  // Filter out all-day / unparseable events and pair with range
  const items = [];
  for (const ev of events) {
    if (ev.isAllDay) continue;
    const r = getRange(ev);
    if (!r) continue;
    items.push({ event: ev, ...r });
  }

  items.sort((a, b) => a.start - b.start || a.end - b.end);

  const laneEndTimes = []; // index = laneIndex, value = latest end-minute placed in that lane
  const placed = [];
  for (const it of items) {
    let lane = laneEndTimes.findIndex((end) => end <= it.start);
    if (lane === -1) {
      laneEndTimes.push(it.end);
      lane = laneEndTimes.length - 1;
    } else {
      laneEndTimes[lane] = it.end;
    }
    placed.push({ event: it.event, laneIndex: lane });
  }

  const laneCount = Math.max(1, laneEndTimes.length);
  return placed.map((p) => ({ ...p, laneCount }));
}
