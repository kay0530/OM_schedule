import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { MEMBERS, MEMBER_ORDER } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useCalendar } from '../../context/CalendarContext';
import {
  toISODate,
  getDayNameJa,
  timeStringToMinutes,
} from '../../utils/dateUtils';
import { STATUS_KEYWORDS } from '../../data/statusTypes';
import { layoutEvents } from '../../utils/eventLayout';
import { getContrastText } from '../../utils/colorUtils';
import EventBlock from './EventBlock';
import StatusOverlay from './StatusOverlay';
import AllDayOverlay from './AllDayOverlay';
import FilterPopover from '../shared/FilterPopover';

const HOUR_HEIGHT = 60;
const START_HOUR = 0;
const END_HOUR = 24;
const TOTAL_HOURS = END_HOUR - START_HOUR;

// Stable empty array for index misses (referential identity across renders)
const EMPTY_LIST = [];

function detectStatusType(title) {
  if (!title) return null;
  for (const [statusId, keywords] of Object.entries(STATUS_KEYWORDS)) {
    for (const kw of keywords) {
      if (title.includes(kw)) return statusId;
    }
  }
  return null;
}

export default function DailyView({ navigate, currentDate, onDateChange, onDropJob, onEventClick, onEventDoubleClick, onMoveAssignment, activeEventId, onSlotClick, onSlotDoubleClick, selectedSlotKey }) {
  const { events, loading } = useCalendar();
  const { assignments, settings, dispatch } = useApp();

  const scrollRef = useRef(null);
  const hasAutoScrolled = useRef(false);

  // Member filter — shared & persisted via settings (hidden-list form)
  const hiddenMemberIds = settings.hiddenMemberIds ?? [];

  const orderedMembers = useMemo(() => {
    return MEMBER_ORDER.map((id) => MEMBERS.find((m) => m.id === id)).filter(Boolean);
  }, []);

  const visibleOrderedMembers = useMemo(() => {
    return orderedMembers.filter((m) => !hiddenMemberIds.includes(m.id));
  }, [orderedMembers, hiddenMemberIds]);

  const dateStr = useMemo(() => toISODate(currentDate), [currentDate]);
  const isToday = useMemo(() => toISODate(new Date()) === dateStr, [dateStr]);
  const dayLabel = useMemo(() => {
    const d = new Date(currentDate);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（${getDayNameJa(d)}）`;
  }, [currentDate]);

  // Auto-scroll to 8:00
  useEffect(() => {
    if (scrollRef.current && !hasAutoScrolled.current) {
      scrollRef.current.scrollTop = (8 - START_HOUR) * HOUR_HEIGHT;
      hasAutoScrolled.current = true;
    }
  }, []);

  function toggleMember(memberId) {
    const next = hiddenMemberIds.includes(memberId)
      ? hiddenMemberIds.filter((x) => x !== memberId)
      : [...hiddenMemberIds, memberId];
    dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenMemberIds: next } });
  }

  function toggleAllMembers() {
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: { hiddenMemberIds: hiddenMemberIds.length === 0 ? [...MEMBER_ORDER] : [] },
    });
  }

  // IDs of Outlook events already represented by an assignment (dedupe)
  const linkedOutlookIds = useMemo(() => {
    const s = new Set();
    for (const a of assignments) if (a.outlookEventId) s.add(a.outlookEventId);
    return s;
  }, [assignments]);

  // ---- Per-member index for the displayed date ----
  // Same pattern as WeeklyView's dayIndex: build the buckets once per data
  // change instead of re-filtering the full arrays ~3× per member per render.
  const dayIndex = useMemo(() => {
    const evTimed = new Map();     // email -> timed Outlook events on dateStr
    const evAllDay = new Map();    // email -> all-day Outlook events covering dateStr
    const asgTimed = new Map();    // memberId -> timed assignments
    const asgAllDay = new Map();   // memberId -> all-day assignments
    const asgDelivery = new Map(); // memberId -> delivery assignments
    const push = (map, key, item) => {
      const arr = map.get(key);
      if (arr) arr.push(item);
      else map.set(key, [item]);
    };
    for (const e of events) {
      if (linkedOutlookIds.has(e.id)) continue; // already shown as assignment
      const email = (e.memberEmail || '').toLowerCase();
      if (!email || !e.start) continue;
      if (e.isAllDay) {
        // Half-open [start, end); broken data (end <= start) still shows on
        // its start day, matching WeeklyView's index behavior
        const eventStart = e.start.substring(0, 10);
        const eventEnd = e.end ? e.end.substring(0, 10) : eventStart;
        const covered = dateStr >= eventStart
          && (dateStr < eventEnd || (eventEnd <= eventStart && dateStr === eventStart));
        if (covered) push(evAllDay, email, e);
      } else if (e.start.substring(0, 10) === dateStr) {
        push(evTimed, email, e);
      }
    }
    for (const a of assignments) {
      if (!a.memberId || a.date !== dateStr) continue;
      if (a.isDelivery) push(asgDelivery, a.memberId, a);
      else if (a.isAllDay) push(asgAllDay, a.memberId, a);
      else push(asgTimed, a.memberId, a);
    }
    return { evTimed, evAllDay, asgTimed, asgAllDay, asgDelivery };
  }, [events, assignments, dateStr, linkedOutlookIds]);

  const getEventsForMember = useCallback(
    (memberEmail) => dayIndex.evTimed.get(memberEmail.toLowerCase()) || EMPTY_LIST,
    [dayIndex]
  );

  const getAllDayEventsForMember = useCallback(
    (memberEmail) => dayIndex.evAllDay.get(memberEmail.toLowerCase()) || EMPTY_LIST,
    [dayIndex]
  );

  const getAssignmentsForMember = useCallback(
    (memberId) => dayIndex.asgTimed.get(memberId) || EMPTY_LIST,
    [dayIndex]
  );

  const getAllDayAssignmentsForMember = useCallback(
    (memberId) => dayIndex.asgAllDay.get(memberId) || EMPTY_LIST,
    [dayIndex]
  );

  const getDeliveriesForMember = useCallback(
    (memberId) => dayIndex.asgDelivery.get(memberId) || EMPTY_LIST,
    [dayIndex]
  );

  const getMemberStatus = useCallback(
    (memberEmail) => {
      const allDay = getAllDayEventsForMember(memberEmail);
      for (const ev of allDay) {
        const statusType = detectStatusType(ev.title);
        if (statusType) return statusType;
      }
      return null;
    },
    [getAllDayEventsForMember]
  );

  const hasAnyAllDayEvents = useMemo(
    () => events.some((e) => e.isAllDay) || assignments.some((a) => a.isAllDay && !a.isDelivery && a.date === dateStr),
    [events, assignments, dateStr]
  );

  // Current time indicator
  const [currentTimePos, setCurrentTimePos] = useState(null);
  useEffect(() => {
    function update() {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      if (h >= START_HOUR && h < END_HOUR) {
        setCurrentTimePos(((h - START_HOUR) * 60 + m) / 60 * HOUR_HEIGHT);
      } else {
        setCurrentTimePos(null);
      }
    }
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, []);

  // Drag and drop
  const [dragOverCell, setDragOverCell] = useState(null);

  function handleDragOver(e, hour, memberId) {
    e.preventDefault();
    setDragOverCell(`${dateStr}-${memberId}-${hour}`);
  }

  function handleDragLeave() {
    setDragOverCell(null);
  }

  function handleDrop(e, hour, memberId) {
    e.preventDefault();
    setDragOverCell(null);
    try {
      const rawData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (rawData.type === 'event-move') {
        const { eventId, durationMinutes, event: originalEvent } = rawData;
        const newStartTime = `${String(hour).padStart(2, '0')}:00`;
        const clampedEnd = Math.min(hour * 60 + durationMinutes, END_HOUR * 60);
        const newEndTime = `${String(Math.floor(clampedEnd / 60)).padStart(2, '0')}:${String(clampedEnd % 60).padStart(2, '0')}`;
        const targetMember = MEMBERS.find((m) => m.id === memberId);
        const movePayload = {
          id: eventId,
          date: dateStr,
          startTime: newStartTime,
          endTime: newEndTime,
          memberId,
          memberEmail: targetMember?.email || originalEvent?.memberEmail,
        };
        // onMoveAssignment mirrors the move to Outlook for synced assignments
        if (onMoveAssignment) onMoveAssignment(movePayload);
        else dispatch({ type: 'UPDATE_ASSIGNMENT', payload: movePayload });
        return;
      }
      const startTime = `${String(hour).padStart(2, '0')}:00`;
      const endTime = `${String(Math.min(hour + 1, END_HOUR)).padStart(2, '0')}:00`;
      if (onDropJob) onDropJob(rawData, dateStr, memberId, startTime, endTime);
    } catch {}
  }

  function handleDeliveryDrop(e, memberId) {
    e.preventDefault();
    setDragOverCell(null);
    try {
      const rawData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (rawData.type === 'event-move') return;
      dispatch({
        type: 'ADD_ASSIGNMENT',
        payload: {
          sourceType: rawData.type || 'opportunity',
          opportunityId: rawData.id,
          opportunityName: `【納品】${rawData.name}`,
          accountName: rawData.accountName || null,
          memberId,
          date: dateStr,
          startTime: '08:00',
          endTime: '17:00',
          isDelivery: true,
          address: rawData.address || null,
        },
      });
    } catch {}
  }

  // changes = {startTime?} (top edge) or {endTime?} (bottom edge)
  const handleResizeEnd = useCallback((event, changes) => {
    if (!event.opportunityName) return;
    const payload = { id: event.id, ...changes };
    if (onMoveAssignment) onMoveAssignment(payload);
    else dispatch({ type: 'UPDATE_ASSIGNMENT', payload });
  }, [dispatch, onMoveAssignment]);

  function handleSlotSingleClick(hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (onSlotClick) onSlotClick(dateStr, timeStr, memberId);
  }

  function handleSlotDoubleClick(hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (onSlotDoubleClick) onSlotDoubleClick(dateStr, timeStr, memberId);
  }

  const gridHeight = TOTAL_HOURS * HOUR_HEIGHT;

  // Business-hours shading bands (Outlook-style); weekends shade full column
  const workStartMin = timeStringToMinutes(settings.workingHours?.start || '08:00');
  const workEndMin = timeStringToMinutes(settings.workingHours?.end || '18:00');
  const offTopH = (workStartMin / 60) * HOUR_HEIGHT;
  const offBottomTop = (workEndMin / 60) * HOUR_HEIGHT;
  const isWeekendDay = currentDate.getDay() === 0 || currentDate.getDay() === 6;

  const renderOffHours = (weekend) =>
    weekend ? (
      <div className="absolute inset-0 bg-offhours pointer-events-none" />
    ) : (
      <>
        <div className="absolute inset-x-0 top-0 bg-offhours pointer-events-none" style={{ height: `${offTopH}px` }} />
        <div className="absolute inset-x-0 bg-offhours pointer-events-none" style={{ top: `${offBottomTop}px`, bottom: 0 }} />
      </>
    );

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* One-row toolbar: label + member filter */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h2 className={`text-sm font-semibold mr-1 ${isToday ? 'text-accent' : 'text-ink'}`}>{dayLabel}</h2>

        <FilterPopover
          label="メンバー"
          items={orderedMembers.map((m) => ({
            id: m.id,
            label: m.nameJa,
            color: m.color,
            checked: !hiddenMemberIds.includes(m.id),
          }))}
          onToggle={toggleMember}
          onToggleAll={toggleAllMembers}
          allChecked={hiddenMemberIds.length === 0}
        />

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
            {/* Sticky header */}
            <div className="sticky top-0 z-20 bg-raised border-b border-edge">
              {/* Member headers */}
              <div className="flex">
                <div className="w-14 shrink-0 border-r border-edge sticky left-0 z-30 bg-raised" />
                {visibleOrderedMembers.map((member, mIdx) => (
                  <div
                    key={member.id}
                    className={`flex-1 min-w-0 text-center py-2 ${
                      mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-edge' : ''
                    }`}
                  >
                    <div
                      className="text-xs font-bold rounded-sm mx-1 py-1"
                      style={{ backgroundColor: member.color, color: getContrastText(member.color) }}
                    >
                      {member.nameJa}
                    </div>
                  </div>
                ))}
              </div>

              {/* All-day events */}
              {hasAnyAllDayEvents && (
                <div className="flex border-t border-edge" style={{ minHeight: '24px' }}>
                  <div className="w-14 shrink-0 border-r border-edge flex items-center justify-end pr-2 text-[10px] text-ink-faint sticky left-0 z-30 bg-raised">
                    終日
                  </div>
                  {visibleOrderedMembers.map((member, mIdx) => {
                    const allDayEvts = getAllDayEventsForMember(member.email);
                    const allDayAsg = getAllDayAssignmentsForMember(member.id);
                    const useOutlookColor = settings.colorOutlookEvents ?? true;
                    return (
                      <div
                        key={`allday-${member.id}`}
                        className={`flex-1 min-w-0 overflow-hidden px-0.5 py-0.5 cursor-pointer hover:bg-surface-hover ${
                          mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-edge' : ''
                        }`}
                        onDoubleClick={() => onSlotDoubleClick && onSlotDoubleClick(dateStr, '08:00', member.id, { isAllDay: true })}
                      >
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
                        {allDayAsg.map((a) => {
                          const synced = !!a.outlookEventId;
                          return (
                            <div
                              key={a.id}
                              className={`text-[10px] font-semibold leading-tight truncate rounded px-1 py-1 mb-0.5 cursor-pointer flex items-center gap-1 ${
                                synced ? 'event-solid' : 'event-tint'
                              }`}
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
              )}
            </div>

            {/* Time grid body */}
            <div className="flex" style={{ minHeight: `${gridHeight}px` }}>
              {/* Time labels */}
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

              {/* Member columns */}
              {visibleOrderedMembers.map((member, mIdx) => {
                const memberEvents = getEventsForMember(member.email);
                const memberAssignments = getAssignmentsForMember(member.id);
                const statusType = getMemberStatus(member.email);

                return (
                  <div
                    key={member.id}
                    className={`flex-1 min-w-0 relative ${
                      mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-edge' : ''
                    }`}
                  >
                    {/* Off-hours / weekend shading */}
                    {renderOffHours(isWeekendDay)}

                    {/* Current time indicator */}
                    {isToday && currentTimePos !== null && (
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
                      const cellKey = `${dateStr}-${member.id}-${hour}`;
                      const isDragOver = dragOverCell === cellKey;
                      const isSelectedSlot = selectedSlotKey === cellKey;
                      return (
                        <div
                          key={hour}
                          className={`border-b border-grid relative transition-colors ${
                            isDragOver ? 'bg-drop ring-1 ring-inset ring-accent' : isSelectedSlot ? 'bg-accent-soft ring-2 ring-inset ring-accent' : ''
                          }`}
                          style={{ height: `${HOUR_HEIGHT}px` }}
                          onClick={() => handleSlotSingleClick(hour, 0, member.id)}
                          onDoubleClick={() => handleSlotDoubleClick(hour, 0, member.id)}
                          onDragOver={(e) => handleDragOver(e, hour, member.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, hour, member.id)}
                        >
                          <div
                            className="absolute left-0 right-0 border-b border-grid-faint"
                            style={{ top: `${HOUR_HEIGHT / 2}px` }}
                          />
                        </div>
                      );
                    })}

                    {/* Status overlay */}
                    {statusType && <StatusOverlay statusType={statusType} totalHeight={gridHeight} />}

                    {/* All-day full-column highlight */}
                    <AllDayOverlay
                      items={[
                        ...getAllDayEventsForMember(member.email).map((e) => ({ id: `o-${e.id}`, color: member.color, draft: false })),
                        ...getAllDayAssignmentsForMember(member.id).map((a) => ({ id: `a-${a.id}`, color: member.color, draft: !a.outlookEventId })),
                      ]}
                      totalHeight={gridHeight}
                    />

                    {/* Combined events with lane-based layout for overlaps */}
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
          </div>
        </div>
      </div>
    </div>
  );
}
