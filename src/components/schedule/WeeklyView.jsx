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
import { WORK_CATEGORIES, WORK_CATEGORY_IDS, getAssignmentCategoryId } from '../../data/workCategories';
import { layoutEvents } from '../../utils/eventLayout';
import { getContrastText } from '../../utils/colorUtils';
import EventBlock from './EventBlock';
import StatusOverlay from './StatusOverlay';
import AllDayOverlay from './AllDayOverlay';
import FilterPopover from '../shared/FilterPopover';

// Time grid constants
const HOUR_HEIGHT = 60; // pixels per hour
const START_HOUR = 0;
const END_HOUR = 24;
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
export default function WeeklyView({ navigate, currentDate, onDateChange, onDropJob, onEventClick, onEventDoubleClick, activeEventId, onSlotClick, onSlotDoubleClick }) {
  const { events, loading } = useCalendar();
  const { assignments, settings, dispatch } = useApp();

  const colorOutlookEvents = settings.colorOutlookEvents ?? true;
  function toggleColorOutlook() {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { colorOutlookEvents: !colorOutlookEvents } });
  }

  const scrollRef = useRef(null);
  const hasAutoScrolled = useRef(false);

  // ===== Shared, persisted view state (settings — see AppContext) =====
  const axisMode = settings.viewAxis === 'person' ? 'person' : 'date';
  function handleAxisChange(mode) {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { viewAxis: mode } });
  }

  const hiddenMemberIds = settings.hiddenMemberIds ?? [];
  function toggleMemberFilter(id) {
    const next = hiddenMemberIds.includes(id)
      ? hiddenMemberIds.filter((x) => x !== id)
      : [...hiddenMemberIds, id];
    dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenMemberIds: next } });
  }
  function toggleAllMemberFilter() {
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: { hiddenMemberIds: hiddenMemberIds.length === 0 ? [...MEMBER_ORDER] : [] },
    });
  }

  const ALL_CATEGORY_IDS = useMemo(() => [...WORK_CATEGORY_IDS, '__none__'], []);
  const hiddenCategoryIds = settings.hiddenCategoryIds ?? [];
  function toggleCategory(id) {
    const next = hiddenCategoryIds.includes(id)
      ? hiddenCategoryIds.filter((x) => x !== id)
      : [...hiddenCategoryIds, id];
    dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenCategoryIds: next } });
  }
  function toggleAllCategories() {
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: { hiddenCategoryIds: hiddenCategoryIds.length === 0 ? [...ALL_CATEGORY_IDS] : [] },
    });
  }

  function isAssignmentVisibleByCategory(a) {
    const cat = getAssignmentCategoryId(a) || '__none__';
    return !hiddenCategoryIds.includes(cat);
  }

  // Ordered members list
  const orderedMembers = useMemo(() => {
    return MEMBER_ORDER
      .map((id) => MEMBERS.find((m) => m.id === id))
      .filter(Boolean);
  }, []);

  // Filtered visible members (hidden-list form so new members default visible)
  const visibleOrderedMembers = useMemo(() => {
    return orderedMembers.filter((m) => !hiddenMemberIds.includes(m.id));
  }, [orderedMembers, hiddenMemberIds]);

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

  // Set of Outlook event IDs already represented by an assignment — used to
  // dedupe so an event doesn't render twice (once as Outlook event, once as
  // assignment) when the app pushed it to Outlook.
  const linkedOutlookIds = useMemo(() => {
    const s = new Set();
    for (const a of assignments) {
      if (a.outlookEventId) s.add(a.outlookEventId);
    }
    return s;
  }, [assignments]);

  // Get timed events for a member + date (from CalendarContext)
  const getEventsForMemberDate = useCallback(
    (memberEmail, date) => {
      const dateStr = toISODate(date);
      return events.filter((e) => {
        if (e.isAllDay) return false;
        if (linkedOutlookIds.has(e.id)) return false; // already shown as assignment
        const eventDate = e.start.substring(0, 10);
        return eventDate === dateStr && e.memberEmail === memberEmail.toLowerCase();
      });
    },
    [events, linkedOutlookIds]
  );

  // Get all-day events for a member + date
  const getAllDayEventsForMemberDate = useCallback(
    (memberEmail, date) => {
      const dateStr = toISODate(date);
      return events.filter((e) => {
        if (!e.isAllDay) return false;
        if (linkedOutlookIds.has(e.id)) return false; // already shown as assignment
        const eventStart = e.start.substring(0, 10);
        const eventEnd = e.end ? e.end.substring(0, 10) : eventStart;
        return dateStr >= eventStart && dateStr < eventEnd && e.memberEmail === memberEmail.toLowerCase();
      });
    },
    [events, linkedOutlookIds]
  );

  // Get all-day ASSIGNMENTS for a member + date (rendered in the 終日 row)
  const getAllDayAssignmentsForMemberDate = useCallback(
    (memberId, date) => {
      const dateStr = toISODate(date);
      return assignments.filter(
        (a) =>
          a.memberId === memberId &&
          a.date === dateStr &&
          a.isAllDay &&
          !a.isDelivery &&
          isAssignmentVisibleByCategory(a)
      );
    },
    [assignments, hiddenCategoryIds]
  );

  // Get assignments for a member + date (from AppContext), excluding deliveries
  // AND excluding all-day items (those are shown in the 終日 row)
  const getAssignmentsForMemberDate = useCallback(
    (memberId, date) => {
      const dateStr = toISODate(date);
      return assignments.filter(
        (a) =>
          a.memberId === memberId &&
          a.date === dateStr &&
          !a.isDelivery &&
          !a.isAllDay &&
          isAssignmentVisibleByCategory(a)
      );
    },
    [assignments, hiddenCategoryIds]
  );

  // Build combined all-day items (Outlook + assignment) for the full-day
  // column overlay highlight
  const getAllDayOverlayItems = useCallback(
    (member, date) => {
      const evts = getAllDayEventsForMemberDate(member.email, date).map((e) => ({
        id: `o-${e.id}`,
        color: member.color,
        draft: false,
      }));
      const asg = getAllDayAssignmentsForMemberDate(member.id, date).map((a) => ({
        id: `a-${a.id}`,
        color: member.color,
        draft: !a.outlookEventId,
      }));
      return [...evts, ...asg];
    },
    [getAllDayEventsForMemberDate, getAllDayAssignmentsForMemberDate]
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

  // Get delivery assignments for a member + date
  const getDeliveriesForMemberDate = useCallback(
    (memberId, date) => {
      const dateStr = toISODate(date);
      return assignments.filter(
        (a) =>
          a.memberId === memberId &&
          a.date === dateStr &&
          a.isDelivery &&
          isAssignmentVisibleByCategory(a)
      );
    },
    [assignments, hiddenCategoryIds]
  );

  // Check if any all-day events (Outlook OR assignment) exist in visible data
  const hasAnyAllDayEvents = useMemo(() => {
    return events.some((e) => e.isAllDay) || assignments.some((a) => a.isAllDay && !a.isDelivery);
  }, [events, assignments]);

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

  // Handle drop on delivery row — register directly without modal
  function handleDeliveryDrop(e, date, memberId) {
    e.preventDefault();
    setDragOverCell(null);
    try {
      const rawData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (rawData.type === 'event-move') return; // Don't handle event-move in delivery row
      const member = MEMBERS.find((m) => m.id === memberId);
      dispatch({
        type: 'ADD_ASSIGNMENT',
        payload: {
          sourceType: rawData.type || 'opportunity',
          opportunityId: rawData.id,
          opportunityName: `【納品】${rawData.name}`,
          accountName: rawData.accountName || null,
          memberId,
          date: toISODate(date),
          startTime: '08:00',
          endTime: '17:00',
          isDelivery: true,
          address: rawData.address || null,
        },
      });
    } catch {
      // Invalid drag data
    }
  }

  // Drag-and-drop state
  const [dragOverCell, setDragOverCell] = useState(null);

  function handleDragOver(e, date, hour, memberId) {
    e.preventDefault();
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
      const rawData = JSON.parse(e.dataTransfer.getData('application/json'));

      // Check if this is an event-move operation (dragging existing assignment)
      if (rawData.type === 'event-move') {
        const { eventId, durationMinutes, event: originalEvent } = rawData;
        const newDate = toISODate(date);
        const newStartTime = `${String(hour).padStart(2, '0')}:00`;
        const newEndMinutes = hour * 60 + durationMinutes;
        const clampedEnd = Math.min(newEndMinutes, END_HOUR * 60);
        const newEndHour = Math.floor(clampedEnd / 60);
        const newEndMin = clampedEnd % 60;
        const newEndTime = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}`;

        const targetMember = MEMBERS.find((m) => m.id === memberId);
        dispatch({
          type: 'UPDATE_ASSIGNMENT',
          payload: {
            id: eventId,
            date: newDate,
            startTime: newStartTime,
            endTime: newEndTime,
            memberId: memberId,
            memberEmail: targetMember?.email || originalEvent?.memberEmail,
          },
        });
        return;
      }

      // Default: dropping a JobCard from sidebar
      const startTime = `${String(hour).padStart(2, '0')}:00`;
      const endHour = Math.min(hour + 1, END_HOUR);
      const endTime = `${String(endHour).padStart(2, '0')}:00`;
      if (onDropJob) {
        onDropJob(rawData, toISODate(date), memberId, startTime, endTime);
      }
    } catch {
      // Invalid drag data
    }
  }

  // Handle resize end from EventBlock
  const handleResizeEnd = useCallback((event, newEndTime) => {
    if (!event.opportunityName) return; // Only assignments
    dispatch({
      type: 'UPDATE_ASSIGNMENT',
      payload: {
        id: event.id,
        endTime: newEndTime,
      },
    });
  }, [dispatch]);

  // Handle single click on empty slot (place picked job)
  function handleSlotSingleClick(date, hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (onSlotClick) {
      onSlotClick(toISODate(date), timeStr, memberId);
    }
  }

  // Handle double-click on empty slot to quick-add
  function handleSlotDoubleClick(date, hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (onSlotDoubleClick) {
      onSlotDoubleClick(toISODate(date), timeStr, memberId);
    }
  }

  // Total grid height
  const gridHeight = TOTAL_HOURS * HOUR_HEIGHT;

  // Business-hours shading bands (P1-5): everything outside workingHours is
  // dimmed, Outlook-style. Weekends shade the full column.
  const workStartMin = timeStringToMinutes(settings.workingHours?.start || '08:00');
  const workEndMin = timeStringToMinutes(settings.workingHours?.end || '18:00');
  const offTopH = (workStartMin / 60) * HOUR_HEIGHT;
  const offBottomTop = (workEndMin / 60) * HOUR_HEIGHT;

  // Off-hours shading bands rendered before the hour cells (so cell dragOver
  // backgrounds paint above them in DOM order; both are positioned)
  const renderOffHours = (isWeekend) =>
    isWeekend ? (
      <div className="absolute inset-0 bg-offhours pointer-events-none" />
    ) : (
      <>
        <div className="absolute inset-x-0 top-0 bg-offhours pointer-events-none" style={{ height: `${offTopH}px` }} />
        <div className="absolute inset-x-0 bg-offhours pointer-events-none" style={{ top: `${offBottomTop}px`, bottom: 0 }} />
      </>
    );

  // All-day chip class helper (P1-4): solid for synced/Outlook, tint for drafts
  const alldayChipClass = (solid) => (solid ? 'event-solid' : 'event-tint');

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* One-row toolbar: label + axis toggle + filters + display options */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h2 className="text-sm font-semibold text-ink mr-1">{weekLabel}</h2>

        {/* Axis mode segmented control (Outlook-style pill) */}
        <div className="inline-flex bg-canvas rounded-lg p-0.5">
          <button
            onClick={() => handleAxisChange('date')}
            className={`text-xs px-3 py-1 font-medium rounded-md transition-colors ${
              axisMode === 'date'
                ? 'bg-surface text-ink shadow-sm dark:bg-surface-hover'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            日付軸
          </button>
          <button
            onClick={() => handleAxisChange('person')}
            className={`text-xs px-3 py-1 font-medium rounded-md transition-colors ${
              axisMode === 'person'
                ? 'bg-surface text-ink shadow-sm dark:bg-surface-hover'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            人軸
          </button>
        </div>

        {/* Category filter popover */}
        <FilterPopover
          label="作業種別"
          items={[
            ...WORK_CATEGORIES.map((c) => ({
              id: c.id,
              label: c.label,
              color: c.color,
              checked: !hiddenCategoryIds.includes(c.id),
            })),
            { id: '__none__', label: '未分類', checked: !hiddenCategoryIds.includes('__none__') },
          ]}
          onToggle={toggleCategory}
          onToggleAll={toggleAllCategories}
          allChecked={hiddenCategoryIds.length === 0}
        />

        {/* Member filter popover */}
        <FilterPopover
          label="メンバー"
          items={orderedMembers.map((m) => ({
            id: m.id,
            label: m.nameJa,
            color: m.color,
            checked: !hiddenMemberIds.includes(m.id),
          }))}
          onToggle={toggleMemberFilter}
          onToggleAll={toggleAllMemberFilter}
          allChecked={hiddenMemberIds.length === 0}
        />

        {/* Display options */}
        <button
          onClick={toggleColorOutlook}
          className={`text-xs px-2.5 py-1 font-medium rounded-lg border transition-colors ${
            colorOutlookEvents
              ? 'bg-accent-soft text-accent border-accent/40'
              : 'bg-surface text-ink-muted border-edge hover:bg-surface-hover'
          }`}
          title="Outlook予定の色表示を切替"
        >
          {colorOutlookEvents ? 'Outlook色付き' : 'Outlook無色'}
        </button>
        <button
          onClick={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { showWeekends: !showWeekends } })}
          className={`text-xs px-2.5 py-1 font-medium rounded-lg border transition-colors ${
            showWeekends
              ? 'bg-accent-soft text-accent border-accent/40'
              : 'bg-surface text-ink-muted border-edge hover:bg-surface-hover'
          }`}
          title="週末の表示を切替"
        >
          週末
        </button>

        {loading && (
          <svg className="w-3.5 h-3.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
      </div>

      {/* Calendar grid */}
      <div className="bg-surface rounded-xl overflow-hidden border border-edge flex-1 min-h-0 shadow-sm">
        <div ref={scrollRef} className="h-full overflow-auto">
          <div className="flex flex-col">

            {/* ========== DATE-AXIS VIEW (default) ========== */}
            {axisMode === 'date' && (
              <>
                {/* Sticky header */}
                <div className="sticky top-0 z-20 bg-raised border-b border-edge">
                  {/* Day headers row */}
                  <div className="flex">
                    {/* Time column spacer */}
                    <div className="w-14 shrink-0 border-r border-edge sticky left-0 z-30 bg-raised" />

                    {/* Day columns */}
                    {displayDates.map((date, dIdx) => {
                      const today = isToday(date);
                      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                      return (
                        <div
                          key={toISODate(date)}
                          className={`flex-1 text-center py-2 ${
                            dIdx < displayDates.length - 1 ? 'border-r border-edge' : ''
                          } ${today ? 'bg-accent-soft' : ''}`}
                         
                        >
                          <div className={`text-xs ${isWeekend ? 'text-ink-faint' : 'text-ink-muted'}`}>
                            {getDayNameJa(date)}
                          </div>
                          <div
                            className={`text-sm font-bold ${
                              today
                                ? 'text-accent'
                                : isWeekend
                                  ? 'text-ink-faint'
                                  : 'text-ink'
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
                                  className="flex-1 min-w-0 text-[9px] font-medium rounded-sm py-0.5 truncate"
                                  style={{ backgroundColor: member.color, color: getContrastText(member.color) }}
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
                    <div className="flex border-t border-edge" style={{ minHeight: '24px' }}>
                      {/* Time label */}
                      <div className="w-14 shrink-0 border-r border-edge flex items-center justify-end pr-2 text-[10px] text-ink-faint sticky left-0 z-30 bg-raised">
                        終日
                      </div>
                      {/* Day columns */}
                      {displayDates.map((date, dIdx) => (
                        <div
                          key={`allday-${toISODate(date)}`}
                          className={`flex-1 flex ${
                            dIdx < displayDates.length - 1 ? 'border-r border-edge' : ''
                          }`}
                         
                        >
                          {visibleOrderedMembers.map((member) => {
                            const allDayEvts = getAllDayEventsForMemberDate(member.email, date);
                            const allDayAsg = getAllDayAssignmentsForMemberDate(member.id, date);
                            const useOutlookColor = settings.colorOutlookEvents ?? true;
                            return (
                              <div
                                key={`allday-${member.id}-${toISODate(date)}`}
                                className="flex-1 min-w-0 overflow-hidden px-0.5 py-0.5 cursor-pointer hover:bg-surface-hover"
                                onDoubleClick={() => onSlotDoubleClick && onSlotDoubleClick(toISODate(date), '08:00', member.id, { isAllDay: true })}
                              >
                                {/* Outlook all-day — neutral chip unless 'colorOutlookEvents' is on */}
                                {allDayEvts.map((evt) => (
                                  <div
                                    key={evt.id}
                                    className={`text-[10px] font-semibold leading-tight truncate rounded px-1 py-1 mb-0.5 cursor-pointer ${
                                      useOutlookColor ? 'event-solid' : 'event-neutral'
                                    }`}
                                    style={useOutlookColor ? { '--mc': member.color, '--on-mc': getContrastText(member.color) } : {}}
                                    title={evt.title}
                                    onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                                    onDoubleClick={(e) => { e.stopPropagation(); onEventDoubleClick(evt); }}
                                  >
                                    {evt.title}
                                  </div>
                                ))}
                                {/* App-created all-day — solid when synced, tint+hatch when draft */}
                                {allDayAsg.map((a) => {
                                  const synced = !!a.outlookEventId;
                                  return (
                                    <div
                                      key={a.id}
                                      className={`text-[10px] font-semibold leading-tight truncate rounded px-1 py-1 mb-0.5 cursor-pointer flex items-center gap-1 ${alldayChipClass(synced)}`}
                                      style={{ '--mc': member.color, '--on-mc': getContrastText(member.color) }}
                                      title={`${a.opportunityName}${synced ? '（Outlook送信済み）' : '（仮・未送信）'}`}
                                      onClick={(e) => { e.stopPropagation(); onEventClick(a); }}
                                      onDoubleClick={(e) => { e.stopPropagation(); onEventDoubleClick(a); }}
                                    >
                                      <span className={`text-[8px] leading-none px-1 py-px rounded font-bold ${
                                        synced ? 'bg-emerald-600 text-white' : 'bg-amber-300 text-amber-900'
                                      }`}>
                                        {synced ? '✓' : '仮'}
                                      </span>
                                      <span className="truncate">{a.opportunityName}</span>
                                    </div>
                                  );
                                })}
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
                  <div className="w-14 shrink-0 border-r border-edge sticky left-0 z-10 bg-raised">
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-grid text-right pr-2 text-[11px] text-ink-faint relative"
                        style={{ height: `${HOUR_HEIGHT}px` }}
                      >
                        <span className="absolute -top-2 right-2">
                          {String(hour).padStart(2, '0')}:00
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
                        className={`flex-1 flex relative ${
                          dIdx < displayDates.length - 1 ? 'border-r border-edge' : ''
                        } ${today ? 'bg-today' : ''}`}
                       
                      >
                        {/* Current time indicator */}
                        {todayInThisColumn && currentTimePos !== null && (
                          <div
                            className="absolute left-0 right-0 z-30 pointer-events-none"
                            style={{ top: `${currentTimePos}px` }}
                          >
                            <div className="relative">
                              <div className="absolute left-0 w-2 h-2 rounded-full bg-now -translate-y-1/2" />
                              <div className="absolute left-0 right-0 h-[2px] bg-now" />
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
                                mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-grid' : ''
                              }`}
                            >
                              {/* Off-hours / weekend shading (below cells in DOM order) */}
                              {renderOffHours(isWeekend)}

                              {/* Hour grid lines (drop targets) */}
                              {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => {
                                const cellKey = `${toISODate(date)}-${member.id}-${hour}`;
                                const isDragOver = dragOverCell === cellKey;
                                return (
                                  <div
                                    key={hour}
                                    className={`border-b border-grid relative transition-colors ${
                                      isDragOver ? 'bg-drop ring-1 ring-inset ring-accent' : ''
                                    }`}
                                    style={{ height: `${HOUR_HEIGHT}px` }}
                                    onClick={() => handleSlotSingleClick(date, hour, 0, member.id)}
                                    onDoubleClick={() => handleSlotDoubleClick(date, hour, 0, member.id)}
                                    onDragOver={(e) => handleDragOver(e, date, hour, member.id)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, date, hour, member.id)}
                                  >
                                    {/* Half-hour divider */}
                                    <div
                                      className="absolute left-0 right-0 border-b border-grid-faint"
                                      style={{ top: `${HOUR_HEIGHT / 2}px` }}
                                    />
                                  </div>
                                );
                              })}

                              {/* Status overlay (不可/休み/移動) */}
                              {statusType && (
                                <StatusOverlay statusType={statusType} totalHeight={gridHeight} />
                              )}

                              {/* All-day full-column highlight */}
                              <AllDayOverlay items={getAllDayOverlayItems(member, date)} totalHeight={gridHeight} />

                              {/* Combined events laid out into lanes so overlaps render side-by-side */}
                              {layoutEvents([...memberEvents, ...memberAssignments]).map(({ event: ev, laneIndex, laneCount }) => (
                                <EventBlock
                                  key={ev.id}
                                  event={ev}
                                  hourHeight={HOUR_HEIGHT}
                                  startHour={START_HOUR}
                                  memberColor={member.color}
                                  colorOutlook={settings.colorOutlookEvents ?? true}
                                  onClick={onEventClick}
                                  onDoubleClick={onEventDoubleClick}
                                  isActive={activeEventId === ev.id}
                                  onResizeEnd={ev.opportunityName ? handleResizeEnd : undefined}
                                  laneIndex={laneIndex}
                                  laneCount={laneCount}
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
                <div className="sticky top-0 z-20 bg-raised border-b border-edge">
                  {/* Member headers row */}
                  <div className="flex">
                    {/* Time column spacer */}
                    <div className="w-14 shrink-0 border-r border-edge sticky left-0 z-30 bg-raised" />

                    {/* Member columns */}
                    {visibleOrderedMembers.map((member, mIdx) => (
                      <div
                        key={member.id}
                        className={`flex-1 text-center py-2 ${
                          mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-edge' : ''
                        }`}
                       
                      >
                        {/* Member name with color bar */}
                        <div
                          className="text-xs font-bold rounded-sm mx-1 py-1"
                          style={{ backgroundColor: member.color, color: getContrastText(member.color) }}
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
                                    ? 'bg-accent-soft text-accent font-semibold'
                                    : isWeekend
                                      ? 'bg-canvas text-ink-faint'
                                      : 'bg-canvas text-ink-muted'
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
                    <div className="flex border-t border-edge" style={{ minHeight: '24px' }}>
                      {/* Time label */}
                      <div className="w-14 shrink-0 border-r border-edge flex items-center justify-end pr-2 text-[10px] text-ink-faint sticky left-0 z-30 bg-raised">
                        終日
                      </div>
                      {/* Member columns */}
                      {visibleOrderedMembers.map((member, mIdx) => (
                        <div
                          key={`allday-member-${member.id}`}
                          className={`flex-1 flex ${
                            mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-edge' : ''
                          }`}
                         
                        >
                          {displayDates.map((date) => {
                            const allDayEvts = getAllDayEventsForMemberDate(member.email, date);
                            const allDayAsg = getAllDayAssignmentsForMemberDate(member.id, date);
                            return (
                              <div
                                key={`allday-${member.id}-${toISODate(date)}`}
                                className="flex-1 min-w-0 overflow-hidden px-0.5 py-0.5 cursor-pointer hover:bg-surface-hover"
                                onDoubleClick={() => onSlotDoubleClick && onSlotDoubleClick(toISODate(date), '08:00', member.id, { isAllDay: true })}
                              >
                                {allDayEvts.map((evt) => (
                                  <div
                                    key={evt.id}
                                    className={`text-[9px] font-semibold truncate rounded-sm px-1 py-0.5 mb-0.5 cursor-pointer ${
                                      colorOutlookEvents ? 'event-solid' : 'event-neutral'
                                    }`}
                                    style={colorOutlookEvents ? { '--mc': member.color, '--on-mc': getContrastText(member.color) } : {}}
                                    title={evt.title}
                                    onClick={(e) => { e.stopPropagation(); onEventClick(evt); }}
                                    onDoubleClick={(e) => { e.stopPropagation(); onEventDoubleClick(evt); }}
                                  >
                                    {evt.title}
                                  </div>
                                ))}
                                {allDayAsg.map((a) => {
                                  const synced = !!a.outlookEventId;
                                  return (
                                    <div
                                      key={a.id}
                                      className={`text-[9px] font-semibold truncate rounded-sm px-1 py-0.5 mb-0.5 cursor-pointer flex items-center gap-1 ${alldayChipClass(synced)}`}
                                      style={{ '--mc': member.color, '--on-mc': getContrastText(member.color) }}
                                      title={`${a.opportunityName}${synced ? '（Outlook送信済み）' : '（仮・未送信）'}`}
                                      onClick={(e) => { e.stopPropagation(); onEventClick(a); }}
                                      onDoubleClick={(e) => { e.stopPropagation(); onEventDoubleClick(a); }}
                                    >
                                      <span className={`text-[7px] leading-none px-0.5 rounded font-bold ${
                                        synced ? 'bg-emerald-600 text-white' : 'bg-amber-400 text-amber-900'
                                      }`}>
                                        {synced ? '✓' : '仮'}
                                      </span>
                                      <span className="truncate">{a.opportunityName}</span>
                                    </div>
                                  );
                                })}
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
                  <div className="w-14 shrink-0 border-r border-edge sticky left-0 z-10 bg-raised">
                    {Array.from({ length: TOTAL_HOURS }, (_, i) => START_HOUR + i).map((hour) => (
                      <div
                        key={hour}
                        className="border-b border-grid text-right pr-2 text-[11px] text-ink-faint relative"
                        style={{ height: `${HOUR_HEIGHT}px` }}
                      >
                        <span className="absolute -top-2 right-2">
                          {String(hour).padStart(2, '0')}:00
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Member columns with day sub-columns */}
                  {visibleOrderedMembers.map((member, mIdx) => (
                    <div
                      key={member.id}
                      className={`flex-1 flex relative ${
                        mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-edge' : ''
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
                              dIdx < displayDates.length - 1 ? 'border-r border-grid' : ''
                            } ${today ? 'bg-today' : ''}`}
                          >
                            {/* Off-hours / weekend shading (below cells in DOM order) */}
                            {renderOffHours(isWeekend)}

                            {/* Current time indicator */}
                            {today && currentTimePos !== null && (
                              <div
                                className="absolute left-0 right-0 z-30 pointer-events-none"
                                style={{ top: `${currentTimePos}px` }}
                              >
                                <div className="relative">
                                  <div className="absolute left-0 w-2 h-2 rounded-full bg-now -translate-y-1/2" />
                                  <div className="absolute left-0 right-0 h-[2px] bg-now" />
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
                                  className={`border-b border-grid relative transition-colors ${
                                    isDragOver ? 'bg-drop ring-1 ring-inset ring-accent' : ''
                                  }`}
                                  style={{ height: `${HOUR_HEIGHT}px` }}
                                  onClick={() => handleSlotSingleClick(date, hour, 0, member.id)}
                                    onDoubleClick={() => handleSlotDoubleClick(date, hour, 0, member.id)}
                                  onDragOver={(e) => handleDragOver(e, date, hour, member.id)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDrop(e, date, hour, member.id)}
                                >
                                  {/* Half-hour divider */}
                                  <div
                                    className="absolute left-0 right-0 border-b border-grid-faint"
                                    style={{ top: `${HOUR_HEIGHT / 2}px` }}
                                  />
                                </div>
                              );
                            })}

                            {/* Status overlay (不可/休み/移動) */}
                            {statusType && (
                              <StatusOverlay statusType={statusType} totalHeight={gridHeight} />
                            )}

                            {/* All-day full-column highlight */}
                            <AllDayOverlay items={getAllDayOverlayItems(member, date)} totalHeight={gridHeight} />

                            {/* Combined events laid out into lanes */}
                            {layoutEvents([...memberEvents, ...memberAssignments]).map(({ event: ev, laneIndex, laneCount }) => (
                              <EventBlock
                                key={ev.id}
                                event={ev}
                                hourHeight={HOUR_HEIGHT}
                                startHour={START_HOUR}
                                memberColor={member.color}
                                colorOutlook={settings.colorOutlookEvents ?? true}
                                onClick={onEventClick}
                                onDoubleClick={onEventDoubleClick}
                                isActive={activeEventId === ev.id}
                                onResizeEnd={ev.opportunityName ? handleResizeEnd : undefined}
                                laneIndex={laneIndex}
                                laneCount={laneCount}
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
