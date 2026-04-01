import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { MEMBERS, MEMBER_ORDER } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useCalendar } from '../../context/CalendarContext';
import {
  getWeekDates,
  toISODate,
  getDayNameJa,
  formatDateShort,
  timeStringToMinutes,
} from '../../utils/dateUtils';
import { STATUS_KEYWORDS } from '../../data/statusTypes';
import EventBlock from './EventBlock';
import StatusOverlay from './StatusOverlay';

// Time grid constants
const HOUR_HEIGHT = 60; // pixels per hour
const START_HOUR = 7;
const END_HOUR = 19;
const TOTAL_HOURS = END_HOUR - START_HOUR;
const SLOT_MINUTES = 30;

// Generate time slot labels (07:00, 07:30, 08:00, ...)
const TIME_SLOTS = [];
for (let h = START_HOUR; h < END_HOUR; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`);
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`);
}

/**
 * Detect status type from an event title using STATUS_KEYWORDS.
 * @param {string} title
 * @returns {string|null} Status type ID or null
 */
function detectStatusType(title) {
  if (!title) return null;
  for (const [statusId, keywords] of Object.entries(STATUS_KEYWORDS)) {
    for (const kw of keywords) {
      if (title.includes(kw)) return statusId;
    }
  }
  return null;
}

/**
 * Weekly calendar view — Outlook-style time grid.
 * Shows days of the week as columns, 30-minute time slots as rows,
 * with member filter chips and events positioned by time.
 */
export default function WeeklyView({ navigate, currentDate, onDateChange, onDropJob, onEventClick }) {
  const { events, loading } = useCalendar();
  const { assignments, settings } = useApp();

  const scrollRef = useRef(null);
  const hasAutoScrolled = useRef(false);

  // Axis mode: 'date' (default) or 'person'
  const [axisMode, setAxisMode] = useState(() => {
    try {
      return localStorage.getItem('construction-schedule-view-axis') || 'date';
    } catch {
      return 'date';
    }
  });

  function handleAxisChange(mode) {
    setAxisMode(mode);
    try {
      localStorage.setItem('construction-schedule-view-axis', mode);
    } catch {
      // localStorage unavailable
    }
  }

  // Member filter state
  const [visibleMembers, setVisibleMembers] = useState(
    () => new Set(MEMBER_ORDER)
  );

  // Ordered members list
  const orderedMembers = useMemo(() => {
    return MEMBER_ORDER
      .map((id) => MEMBERS.find((m) => m.id === id))
      .filter(Boolean);
  }, []);

  // Filtered visible members
  const visibleOrderedMembers = useMemo(() => {
    return orderedMembers.filter((m) => visibleMembers.has(m.id));
  }, [orderedMembers, visibleMembers]);

  // Week dates (Monday start)
  const weekDates = useMemo(() => getWeekDates(currentDate), [currentDate]);

  // Display dates based on showWeekends setting
  const showWeekends = settings.showWeekends ?? false;
  const displayDates = useMemo(() => {
    if (showWeekends) return weekDates;
    return weekDates.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
  }, [weekDates, showWeekends]);

  // Auto-scroll to 8:00 on mount
  useEffect(() => {
    if (scrollRef.current && !hasAutoScrolled.current) {
      const scrollTo = (8 - START_HOUR) * HOUR_HEIGHT;
      scrollRef.current.scrollTop = scrollTo;
      hasAutoScrolled.current = true;
    }
  }, []);

  // Toggle member visibility
  function toggleMember(memberId) {
    setVisibleMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }

  // Select/deselect all members
  function toggleAllMembers() {
    if (visibleMembers.size === MEMBERS.length) {
      setVisibleMembers(new Set());
    } else {
      setVisibleMembers(new Set(MEMBER_ORDER));
    }
  }

  // Check if date is today
  function isToday(date) {
    const today = new Date();
    return toISODate(date) === toISODate(today);
  }

  // Week range label
  const weekLabel = useMemo(() => {
    const start = formatDateShort(displayDates[0]);
    const end = formatDateShort(displayDates[displayDates.length - 1]);
    return `${start}〜${end}`;
  }, [displayDates]);

  // Get timed events for a member + date (from CalendarContext)
  const getEventsForMemberDate = useCallback(
    (memberEmail, date) => {
      const dateStr = toISODate(date);
      return events.filter((e) => {
        if (e.isAllDay) return false;
        const eventDate = e.start.substring(0, 10);
        return eventDate === dateStr && e.memberEmail === memberEmail.toLowerCase();
      });
    },
    [events]
  );

  // Get all-day events for a member + date
  const getAllDayEventsForMemberDate = useCallback(
    (memberEmail, date) => {
      const dateStr = toISODate(date);
      return events.filter((e) => {
        if (!e.isAllDay) return false;
        const eventStart = e.start.substring(0, 10);
        const eventEnd = e.end ? e.end.substring(0, 10) : eventStart;
        return dateStr >= eventStart && dateStr < eventEnd && e.memberEmail === memberEmail.toLowerCase();
      });
    },
    [events]
  );

  // Get assignments for a member + date (from AppContext)
  const getAssignmentsForMemberDate = useCallback(
    (memberId, date) => {
      const dateStr = toISODate(date);
      return assignments.filter(
        (a) => a.memberId === memberId && a.date === dateStr
      );
    },
    [assignments]
  );

  // Detect member status for a given date from all-day events
  const getMemberStatus = useCallback(
    (memberEmail, date) => {
      const allDay = getAllDayEventsForMemberDate(memberEmail, date);
      for (const ev of allDay) {
        const statusType = detectStatusType(ev.title);
        if (statusType) return statusType;
      }
      return null;
    },
    [getAllDayEventsForMemberDate]
  );

  // Check if any all-day events exist in visible data
  const hasAnyAllDayEvents = useMemo(() => {
    return events.some((e) => e.isAllDay);
  }, [events]);

  // Current time indicator position
  const [currentTimePos, setCurrentTimePos] = useState(null);

  useEffect(() => {
    function updateCurrentTime() {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      if (h >= START_HOUR && h < END_HOUR) {
        const offset = ((h - START_HOUR) * 60 + m) / 60 * HOUR_HEIGHT;
        setCurrentTimePos(offset);
      } else {
        setCurrentTimePos(null);
      }
    }

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, []);

  // Drag-and-drop state
  const [dragOverCell, setDragOverCell] = useState(null);

  function handleDragOver(e, date, hour, memberId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const cellKey = `${toISODate(date)}-${memberId}-${hour}`;
    setDragOverCell(cellKey);
  }

  function handleDragLeave() {
    setDragOverCell(null);
  }

  function handleDrop(e, date, hour, memberId) {
    e.preventDefault();
    setDragOverCell(null);
    try {
      const jobData = JSON.parse(e.dataTransfer.getData('application/json'));
      const startTime = `${String(hour).padStart(2, '0')}:00`;
      const endHour = Math.min(hour + 1, END_HOUR);
      const endTime = `${String(endHour).padStart(2, '0')}:00`;
      if (onDropJob) {
        onDropJob(jobData, toISODate(date), memberId, startTime, endTime);
      }
    } catch {
      // Invalid drag data
    }
  }

  // Handle click on empty slot
  function handleSlotClick(date, hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    console.log(`Slot clicked: ${toISODate(date)} ${timeStr} member=${memberId}`);
  }

  // Total grid height
  const gridHeight = TOTAL_HOURS * HOUR_HEIGHT;

  return (
    <div className="flex flex-col h-full">
      {/* Header: navigation + week label */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
          {/* Week navigation */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onDateChange(new Date())}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              今日
            </button>
            <button
              onClick={() => {
                const d = new Date(currentDate);
                d.setDate(d.getDate() - 7);
                onDateChange(d);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="前の週"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => {
                const d = new Date(currentDate);
                d.setDate(d.getDate() + 7);
                onDateChange(d);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="次の週"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <h2 className="text-lg font-bold text-gray-800">{weekLabel}</h2>

          {loading && (
            <span className="text-xs text-blue-400 flex items-center gap-1">
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              読込中...
            </span>
          )}
        </div>
      </div>

      {/* Axis toggle + Member filter chips */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {/* Axis mode toggle */}
        <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden mr-2">
          <button
            onClick={() => handleAxisChange('date')}
            className={`text-xs px-3 py-1 font-medium transition-colors ${
              axisMode === 'date'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            日付軸
          </button>
          <button
            onClick={() => handleAxisChange('person')}
            className={`text-xs px-3 py-1 font-medium transition-colors ${
              axisMode === 'person'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            人軸
          </button>
        </div>
      </div>

      {/* Member filter chips */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <button
          onClick={toggleAllMembers}
          className="text-xs px-2 py-1 rounded border border-gray-300 hover:bg-gray-100 transition-colors"
        >
          {visibleMembers.size === MEMBERS.length ? '全解除' : '全選択'}
        </button>
        {orderedMembers.map((member) => (
          <label key={member.id} className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={visibleMembers.has(member.id)}
              onChange={() => toggleMember(member.id)}
              className="sr-only"
            />
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                visibleMembers.has(member.id)
                  ? 'border-transparent text-white'
                  : 'border-gray-300 text-gray-400 bg-white'
              }`}
              style={
                visibleMembers.has(member.id) ? { backgroundColor: member.color } : {}
              }
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor: visibleMembers.has(member.id) ? 'white' : member.color,
                }}
              />
              {member.nameJa}
            </span>
          </label>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="bg-white rounded-xl overflow-hidden border border-gray-200 flex-1 min-h-0 shadow-sm">
        <div ref={scrollRef} className="h-full overflow-auto">
          <div className="flex flex-col">

            {/* ========== DATE-AXIS VIEW (default) ========== */}
            {axisMode === 'date' && (
              <>
                {/* Sticky header */}
                <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
                  {/* Day headers row */}
                  <div className="flex">
                    {/* Time column spacer */}
                    <div className="w-14 shrink-0 border-r border-gray-200 sticky left-0 z-30 bg-white" />

                    {/* Day columns */}
                    {displayDates.map((date, dIdx) => {
                      const today = isToday(date);
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                      return (
                        <div
                          key={toISODate(date)}
                          className={`flex-1 min-w-[120px] text-center py-2 ${
                            dIdx < displayDates.length - 1 ? 'border-r border-gray-200' : ''
                          } ${today ? 'bg-blue-50' : ''}`}
                        >
                          <div className={`text-xs ${isWeekend ? 'text-gray-400' : 'text-gray-500'}`}>
                            {getDayNameJa(date)}
                          </div>
                          <div
                            className={`text-sm font-bold ${
                              today
                                ? 'text-blue-600'
                                : isWeekend
                                  ? 'text-gray-400'
                                  : 'text-gray-800'
                            }`}
                          >
                            {date.getMonth() + 1}/{date.getDate()}
                          </div>
                          {/* Member sub-columns header */}
                          {visibleOrderedMembers.length > 1 && (
                            <div className="flex mt-1 gap-px px-px">
                              {visibleOrderedMembers.map((member) => (
                                <div
                                  key={member.id}
                                  className="flex-1 min-w-0 text-[9px] text-white font-medium rounded-sm py-0.5 truncate"
                                  style={{ backgroundColor: member.color }}
                                  title={member.nameJa}
                                >
                                  {member.nameJa}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* All-day events banner */}
                  {hasAnyAllDayEvents && (
                    <div className="flex border-t border-gray-200" style={{ minHeight: '24px' }}>
                      {/* Time label */}
                      <div className="w-14 shrink-0 border-r border-gray-200 flex items-center justify-end pr-2 text-[10px] text-gray-400 sticky left-0 z-30 bg-white">
                        終日
                      </div>
                      {/* Day columns */}
                      {displayDates.map((date, dIdx) => (
                        <div
                          key={`allday-${toISODate(date)}`}
                          className={`flex-1 min-w-[120px] flex ${
                            dIdx < displayDates.length - 1 ? 'border-r border-gray-200' : ''
                          }`}
                        >
                          {visibleOrderedMembers.map((member) => {
                            const allDayEvts = getAllDayEventsForMemberDate(member.email, date);
                            return (
                              <div
                                key={`allday-${member.id}-${toISODate(date)}`}
                                className="flex-1 min-w-0 overflow-hidden px-0.5 py-0.5"
                              >
                                {allDayEvts.map((evt) => (
                                  <div
                                    key={evt.id}
                                    className="text-[9px] truncate rounded-sm px-1 py-0.5 mb-0.5"
                                    style={{
                                      backgroundColor: `${member.color}20`,
                                      borderLeft: `2px solid ${member.color}`,
                                      color: member.color,
                                    }}
                                    title={evt.title}
                                  >
                                    {evt.title}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Time grid body */}
                <div className="flex" style={{ minHeight: `${gridHeight}px` }}>
                  {/* Time labels column (sticky left) */}
                  <div className="w-14 shrink-0 border-r border-gray-200 sticky left-0 z-10 bg-white">
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-gray-100 text-right pr-2 text-[11px] text-gray-400 relative"
                        style={{ height: `${HOUR_HEIGHT}px` }}
                      >
                        <span className="absolute -top-2 right-2">
                          {String(hour).padStart(2, '0')}:00
                        </span>
                        {/* Half-hour tick */}
                        <span className="absolute right-2 text-[10px] text-gray-300" style={{ top: `${HOUR_HEIGHT / 2 - 6}px` }}>
                          {String(hour).padStart(2, '0')}:30
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Day columns with member sub-columns */}
                  {displayDates.map((date, dIdx) => {
                    const today = isToday(date);
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                    const todayInThisColumn = today;

                    return (
                      <div
                        key={toISODate(date)}
                        className={`flex-1 min-w-[120px] flex relative ${
                          dIdx < displayDates.length - 1 ? 'border-r border-gray-200' : ''
                        } ${today ? 'bg-blue-50/30' : ''} ${isWeekend ? 'bg-gray-50/50' : ''}`}
                      >
                        {/* Current time indicator */}
                        {todayInThisColumn && currentTimePos !== null && (
                          <div
                            className="absolute left-0 right-0 z-30 pointer-events-none"
                            style={{ top: `${currentTimePos}px` }}
                          >
                            <div className="relative">
                              <div className="absolute left-0 w-2 h-2 rounded-full bg-red-500 -translate-y-1/2" />
                              <div className="absolute left-0 right-0 h-px bg-red-500" />
                            </div>
                          </div>
                        )}

                        {/* Member sub-columns */}
                        {visibleOrderedMembers.map((member, mIdx) => {
                          const memberEvents = getEventsForMemberDate(member.email, date);
                          const memberAssignments = getAssignmentsForMemberDate(member.id, date);
                          const statusType = getMemberStatus(member.email, date);

                          return (
                            <div
                              key={`${toISODate(date)}-${member.id}`}
                              className={`flex-1 min-w-0 relative ${
                                mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-100' : ''
                              }`}
                            >
                              {/* Hour grid lines (drop targets) */}
                              {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => {
                                const cellKey = `${toISODate(date)}-${member.id}-${hour}`;
                                const isDragOver = dragOverCell === cellKey;
                                return (
                                  <div
                                    key={hour}
                                    className={`border-b border-gray-100 relative transition-colors ${
                                      isDragOver ? 'bg-blue-100/60 ring-1 ring-inset ring-blue-400' : ''
                                    }`}
                                    style={{ height: `${HOUR_HEIGHT}px` }}
                                    onClick={() => handleSlotClick(date, hour, 0, member.id)}
                                    onDragOver={(e) => handleDragOver(e, date, hour, member.id)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, date, hour, member.id)}
                                  >
                                    {/* Half-hour divider */}
                                    <div
                                      className="absolute left-0 right-0 border-b border-gray-50"
                                      style={{ top: `${HOUR_HEIGHT / 2}px` }}
                                    />
                                  </div>
                                );
                              })}

                              {/* Status overlay (不可/休み/移動) */}
                              {statusType && (
                                <StatusOverlay statusType={statusType} totalHeight={gridHeight} />
                              )}

                              {/* Calendar events */}
                              {memberEvents.map((event) => (
                                <EventBlock
                                  key={event.id}
                                  event={event}
                                  hourHeight={HOUR_HEIGHT}
                                  startHour={START_HOUR}
                                  memberColor={member.color}
                                  onClick={onEventClick}
                                />
                              ))}

                              {/* Assignment events */}
                              {memberAssignments.map((assignment) => (
                                <EventBlock
                                  key={assignment.id}
                                  event={assignment}
                                  hourHeight={HOUR_HEIGHT}
                                  startHour={START_HOUR}
                                  memberColor={member.color}
                                  onClick={onEventClick}
                                />
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ========== PERSON-AXIS VIEW ========== */}
            {axisMode === 'person' && (
              <>
                {/* Sticky header */}
                <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
                  {/* Member headers row */}
                  <div className="flex">
                    {/* Time column spacer */}
                    <div className="w-14 shrink-0 border-r border-gray-200 sticky left-0 z-30 bg-white" />

                    {/* Member columns */}
                    {visibleOrderedMembers.map((member, mIdx) => (
                      <div
                        key={member.id}
                        className={`flex-1 min-w-[100px] text-center py-2 ${
                          mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                        }`}
                      >
                        {/* Member name with color bar */}
                        <div
                          className="text-xs font-bold text-white rounded-sm mx-1 py-1"
                          style={{ backgroundColor: member.color }}
                        >
                          {member.nameJa}
                        </div>
                        {/* Day sub-columns header */}
                        <div className="flex mt-1 gap-px px-px">
                          {displayDates.map((date) => {
                            const today = isToday(date);
                            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                            return (
                              <div
                                key={toISODate(date)}
                                className={`flex-1 min-w-0 text-[9px] font-medium rounded-sm py-0.5 truncate ${
                                  today
                                    ? 'bg-blue-100 text-blue-700'
                                    : isWeekend
                                      ? 'bg-gray-100 text-gray-400'
                                      : 'bg-gray-100 text-gray-600'
                                }`}
                                title={`${date.getMonth() + 1}/${date.getDate()} ${getDayNameJa(date)}`}
                              >
                                {date.getMonth() + 1}/{date.getDate()}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* All-day events banner */}
                  {hasAnyAllDayEvents && (
                    <div className="flex border-t border-gray-200" style={{ minHeight: '24px' }}>
                      {/* Time label */}
                      <div className="w-14 shrink-0 border-r border-gray-200 flex items-center justify-end pr-2 text-[10px] text-gray-400 sticky left-0 z-30 bg-white">
                        終日
                      </div>
                      {/* Member columns */}
                      {visibleOrderedMembers.map((member, mIdx) => (
                        <div
                          key={`allday-member-${member.id}`}
                          className={`flex-1 min-w-[100px] flex ${
                            mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                          }`}
                        >
                          {displayDates.map((date) => {
                            const allDayEvts = getAllDayEventsForMemberDate(member.email, date);
                            return (
                              <div
                                key={`allday-${member.id}-${toISODate(date)}`}
                                className="flex-1 min-w-0 overflow-hidden px-0.5 py-0.5"
                              >
                                {allDayEvts.map((evt) => (
                                  <div
                                    key={evt.id}
                                    className="text-[9px] truncate rounded-sm px-1 py-0.5 mb-0.5"
                                    style={{
                                      backgroundColor: `${member.color}20`,
                                      borderLeft: `2px solid ${member.color}`,
                                      color: member.color,
                                    }}
                                    title={evt.title}
                                  >
                                    {evt.title}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Time grid body */}
                <div className="flex" style={{ minHeight: `${gridHeight}px` }}>
                  {/* Time labels column (sticky left) */}
                  <div className="w-14 shrink-0 border-r border-gray-200 sticky left-0 z-10 bg-white">
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-gray-100 text-right pr-2 text-[11px] text-gray-400 relative"
                        style={{ height: `${HOUR_HEIGHT}px` }}
                      >
                        <span className="absolute -top-2 right-2">
                          {String(hour).padStart(2, '0')}:00
                        </span>
                        {/* Half-hour tick */}
                        <span className="absolute right-2 text-[10px] text-gray-300" style={{ top: `${HOUR_HEIGHT / 2 - 6}px` }}>
                          {String(hour).padStart(2, '0')}:30
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Member columns with day sub-columns */}
                  {visibleOrderedMembers.map((member, mIdx) => (
                    <div
                      key={member.id}
                      className={`flex-1 min-w-[100px] flex relative ${
                        mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                      }`}
                    >
                      {/* Day sub-columns */}
                      {displayDates.map((date, dIdx) => {
                        const today = isToday(date);
                        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                        const memberEvents = getEventsForMemberDate(member.email, date);
                        const memberAssignments = getAssignmentsForMemberDate(member.id, date);
                        const statusType = getMemberStatus(member.email, date);

                        return (
                          <div
                            key={`${member.id}-${toISODate(date)}`}
                            className={`flex-1 min-w-0 relative ${
                              dIdx < displayDates.length - 1 ? 'border-r border-gray-100' : ''
                            } ${today ? 'bg-blue-50/30' : ''} ${isWeekend ? 'bg-gray-50/50' : ''}`}
                          >
                            {/* Current time indicator */}
                            {today && currentTimePos !== null && (
                              <div
                                className="absolute left-0 right-0 z-30 pointer-events-none"
                                style={{ top: `${currentTimePos}px` }}
                              >
                                <div className="relative">
                                  <div className="absolute left-0 w-2 h-2 rounded-full bg-red-500 -translate-y-1/2" />
                                  <div className="absolute left-0 right-0 h-px bg-red-500" />
                                </div>
                              </div>
                            )}

                            {/* Hour grid lines (drop targets) */}
                            {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => {
                              const cellKey = `${toISODate(date)}-${member.id}-${hour}`;
                              const isDragOver = dragOverCell === cellKey;
                              return (
                                <div
                                  key={hour}
                                  className={`border-b border-gray-100 relative transition-colors ${
                                    isDragOver ? 'bg-blue-100/60 ring-1 ring-inset ring-blue-400' : ''
                                  }`}
                                  style={{ height: `${HOUR_HEIGHT}px` }}
                                  onClick={() => handleSlotClick(date, hour, 0, member.id)}
                                  onDragOver={(e) => handleDragOver(e, date, hour, member.id)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDrop(e, date, hour, member.id)}
                                >
                                  {/* Half-hour divider */}
                                  <div
                                    className="absolute left-0 right-0 border-b border-gray-50"
                                    style={{ top: `${HOUR_HEIGHT / 2}px` }}
                                  />
                                </div>
                              );
                            })}

                            {/* Status overlay (不可/休み/移動) */}
                            {statusType && (
                              <StatusOverlay statusType={statusType} totalHeight={gridHeight} />
                            )}

                            {/* Calendar events */}
                            {memberEvents.map((event) => (
                              <EventBlock
                                key={event.id}
                                event={event}
                                hourHeight={HOUR_HEIGHT}
                                startHour={START_HOUR}
                                memberColor={member.color}
                                onClick={onEventClick}
                              />
                            ))}

                            {/* Assignment events */}
                            {memberAssignments.map((assignment) => (
                              <EventBlock
                                key={assignment.id}
                                event={assignment}
                                hourHeight={HOUR_HEIGHT}
                                startHour={START_HOUR}
                                memberColor={member.color}
                                onClick={onEventClick}
                              />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
