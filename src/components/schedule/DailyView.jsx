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
import EventBlock from './EventBlock';
import StatusOverlay from './StatusOverlay';

const HOUR_HEIGHT = 60;
const START_HOUR = 0;
const END_HOUR = 24;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function detectStatusType(title) {
  if (!title) return null;
  for (const [statusId, keywords] of Object.entries(STATUS_KEYWORDS)) {
    for (const kw of keywords) {
      if (title.includes(kw)) return statusId;
    }
  }
  return null;
}

export default function DailyView({ navigate, currentDate, onDateChange, onDropJob, onEventClick, onSlotClick, onSlotDoubleClick }) {
  const { events, loading } = useCalendar();
  const { assignments, dispatch } = useApp();

  const scrollRef = useRef(null);
  const hasAutoScrolled = useRef(false);

  // Member filter
  const [visibleMembers, setVisibleMembers] = useState(() => new Set(MEMBER_ORDER));

  const orderedMembers = useMemo(() => {
    return MEMBER_ORDER.map((id) => MEMBERS.find((m) => m.id === id)).filter(Boolean);
  }, []);

  const visibleOrderedMembers = useMemo(() => {
    return orderedMembers.filter((m) => visibleMembers.has(m.id));
  }, [orderedMembers, visibleMembers]);

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
    setVisibleMembers((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  function toggleAllMembers() {
    if (visibleMembers.size === MEMBERS.length) setVisibleMembers(new Set());
    else setVisibleMembers(new Set(MEMBER_ORDER));
  }

  const getEventsForMember = useCallback(
    (memberEmail) => {
      return events.filter((e) => {
        if (e.isAllDay) return false;
        return e.start.substring(0, 10) === dateStr && e.memberEmail === memberEmail.toLowerCase();
      });
    },
    [events, dateStr]
  );

  const getAllDayEventsForMember = useCallback(
    (memberEmail) => {
      return events.filter((e) => {
        if (!e.isAllDay) return false;
        const eventStart = e.start.substring(0, 10);
        const eventEnd = e.end ? e.end.substring(0, 10) : eventStart;
        return dateStr >= eventStart && dateStr < eventEnd && e.memberEmail === memberEmail.toLowerCase();
      });
    },
    [events, dateStr]
  );

  const getAssignmentsForMember = useCallback(
    (memberId) => {
      return assignments.filter((a) => a.memberId === memberId && a.date === dateStr && !a.isDelivery);
    },
    [assignments, dateStr]
  );

  const getDeliveriesForMember = useCallback(
    (memberId) => {
      return assignments.filter((a) => a.memberId === memberId && a.date === dateStr && a.isDelivery);
    },
    [assignments, dateStr]
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

  const hasAnyAllDayEvents = useMemo(() => events.some((e) => e.isAllDay), [events]);

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
        dispatch({
          type: 'UPDATE_ASSIGNMENT',
          payload: {
            id: eventId,
            date: dateStr,
            startTime: newStartTime,
            endTime: newEndTime,
            memberId,
            memberEmail: targetMember?.email || originalEvent?.memberEmail,
          },
        });
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

  const handleResizeEnd = useCallback((event, newEndTime) => {
    if (!event.opportunityName) return;
    dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { id: event.id, endTime: newEndTime } });
  }, [dispatch]);

  function handleSlotSingleClick(hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (onSlotClick) onSlotClick(dateStr, timeStr, memberId);
  }

  function handleSlotDoubleClick(hour, minute, memberId) {
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (onSlotDoubleClick) onSlotDoubleClick(dateStr, timeStr, memberId);
  }

  const gridHeight = TOTAL_HOURS * HOUR_HEIGHT;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-4">
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
                d.setDate(d.getDate() - 1);
                onDateChange(d);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="前日"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => {
                const d = new Date(currentDate);
                d.setDate(d.getDate() + 1);
                onDateChange(d);
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
              title="翌日"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <h2 className={`text-lg font-bold ${isToday ? 'text-blue-600' : 'text-gray-800'}`}>{dayLabel}</h2>
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
              style={visibleMembers.has(member.id) ? { backgroundColor: member.color } : {}}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: visibleMembers.has(member.id) ? 'white' : member.color }}
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
            {/* Sticky header */}
            <div className="sticky top-0 z-20 bg-white border-b border-gray-200">
              {/* Member headers */}
              <div className="flex">
                <div className="w-14 shrink-0 border-r border-gray-200 sticky left-0 z-30 bg-white" />
                {visibleOrderedMembers.map((member, mIdx) => (
                  <div
                    key={member.id}
                    className={`flex-1 min-w-[80px] text-center py-2 ${
                      mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                    }`}
                  >
                    <div
                      className="text-xs font-bold text-white rounded-sm mx-1 py-1"
                      style={{ backgroundColor: member.color }}
                    >
                      {member.nameJa}
                    </div>
                  </div>
                ))}
              </div>

              {/* Delivery row */}
              <div className="flex border-t border-gray-200" style={{ minHeight: '24px' }}>
                <div className="w-14 shrink-0 border-r border-gray-200 flex items-center justify-end pr-2 text-[10px] text-orange-500 font-medium sticky left-0 z-30 bg-white">
                  納品
                </div>
                {visibleOrderedMembers.map((member, mIdx) => {
                  const deliveries = getDeliveriesForMember(member.id);
                  const cellKey = `delivery-${dateStr}-${member.id}`;
                  const isDragOver = dragOverCell === cellKey;
                  return (
                    <div
                      key={cellKey}
                      className={`flex-1 min-w-[80px] overflow-hidden px-0.5 py-0.5 transition-colors ${
                        mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                      } ${isDragOver ? 'bg-orange-100/60 ring-1 ring-inset ring-orange-400' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOverCell(cellKey); }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDeliveryDrop(e, member.id)}
                    >
                      {deliveries.map((d) => (
                        <div
                          key={d.id}
                          className="text-[9px] truncate rounded-sm px-1 py-0.5 mb-0.5 cursor-pointer bg-orange-100 border-l-2 border-orange-500 text-orange-700"
                          title={d.opportunityName}
                          onClick={() => onEventClick(d)}
                        >
                          {d.opportunityName?.replace('【納品】', '')}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* All-day events */}
              {hasAnyAllDayEvents && (
                <div className="flex border-t border-gray-200" style={{ minHeight: '24px' }}>
                  <div className="w-14 shrink-0 border-r border-gray-200 flex items-center justify-end pr-2 text-[10px] text-gray-400 sticky left-0 z-30 bg-white">
                    終日
                  </div>
                  {visibleOrderedMembers.map((member, mIdx) => {
                    const allDayEvts = getAllDayEventsForMember(member.email);
                    return (
                      <div
                        key={`allday-${member.id}`}
                        className={`flex-1 min-w-[80px] overflow-hidden px-0.5 py-0.5 ${
                          mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                        }`}
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
              )}
            </div>

            {/* Time grid body */}
            <div className="flex" style={{ minHeight: `${gridHeight}px` }}>
              {/* Time labels */}
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
                    <span className="absolute right-2 text-[10px] text-gray-300" style={{ top: `${HOUR_HEIGHT / 2 - 6}px` }}>
                      {String(hour).padStart(2, '0')}:30
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
                    className={`flex-1 min-w-[80px] relative ${
                      mIdx < visibleOrderedMembers.length - 1 ? 'border-r border-gray-200' : ''
                    }`}
                  >
                    {/* Current time indicator */}
                    {isToday && currentTimePos !== null && (
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
                      const cellKey = `${dateStr}-${member.id}-${hour}`;
                      const isDragOver = dragOverCell === cellKey;
                      return (
                        <div
                          key={hour}
                          className={`border-b border-gray-100 relative transition-colors ${
                            isDragOver ? 'bg-blue-100/60 ring-1 ring-inset ring-blue-400' : ''
                          }`}
                          style={{ height: `${HOUR_HEIGHT}px` }}
                          onClick={() => handleSlotSingleClick(hour, 0, member.id)}
                          onDoubleClick={() => handleSlotDoubleClick(hour, 0, member.id)}
                          onDragOver={(e) => handleDragOver(e, hour, member.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, hour, member.id)}
                        >
                          <div
                            className="absolute left-0 right-0 border-b border-gray-50"
                            style={{ top: `${HOUR_HEIGHT / 2}px` }}
                          />
                        </div>
                      );
                    })}

                    {/* Status overlay */}
                    {statusType && <StatusOverlay statusType={statusType} totalHeight={gridHeight} />}

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
                        onResizeEnd={handleResizeEnd}
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
