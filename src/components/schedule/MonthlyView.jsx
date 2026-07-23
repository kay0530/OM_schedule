import { useState, useMemo, useCallback } from 'react';
import { MEMBERS, MEMBER_ORDER } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useCalendar } from '../../context/CalendarContext';
import { toISODate, getDayNameJa, addDays } from '../../utils/dateUtils';
import { STATUS_KEYWORDS, STATUS_TYPES } from '../../data/statusTypes';
import { useToastContext } from '../shared/Toast';
import HideMemberButton from '../shared/HideMemberButton';

/**
 * Detect status from an Outlook event title using keyword matching.
 * @param {string} eventTitle
 * @returns {string|null} Status ID or null
 */
function detectStatus(eventTitle) {
  if (!eventTitle) return null;
  for (const [statusId, keywords] of Object.entries(STATUS_KEYWORDS)) {
    if (keywords.some((kw) => eventTitle.includes(kw))) return statusId;
  }
  return null;
}

/**
 * Get the STATUS_TYPES entry by status ID.
 */
function getStatusType(statusId) {
  return STATUS_TYPES.find((s) => s.id === statusId) || null;
}

/**
 * Get all dates in a month.
 * @param {Date} date - Any date within the target month
 * @returns {Date[]} All dates in the month
 */
function getMonthDates(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const dates = [];
  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    dates.push(new Date(d));
  }
  return dates;
}

/**
 * Check if a date is a business day (Mon-Fri).
 */
function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

/**
 * Get the Monday of the ISO week for a given date.
 */
function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Group dates by week (Monday-based).
 * @param {Date[]} dates
 * @returns {Array<{weekStart: Date, dates: Date[]}>}
 */
function groupByWeek(dates) {
  const weeks = [];
  let currentWeek = null;

  for (const date of dates) {
    const monday = getWeekMonday(date);
    const mondayKey = toISODate(monday);

    if (!currentWeek || currentWeek.key !== mondayKey) {
      currentWeek = { key: mondayKey, weekStart: monday, dates: [] };
      weeks.push(currentWeek);
    }
    currentWeek.dates.push(date);
  }

  return weeks;
}

/**
 * Monthly calendar view — Excel-style grid showing all members across weeks.
 */
export default function MonthlyView({ navigate, currentDate, onDropJob, onEventClick }) {
  const { assignments, settings, dispatch } = useApp();
  const { events } = useCalendar();
  const { addToast } = useToastContext();
  const showWeekends = settings?.showWeekends ?? false;
  const [dragOverCell, setDragOverCell] = useState(null);

  // Member visibility filter (shared via settings.hiddenMemberIds)
  const hiddenMemberIds = settings?.hiddenMemberIds ?? [];

  function toggleMember(memberId) {
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: {
        hiddenMemberIds: hiddenMemberIds.includes(memberId)
          ? hiddenMemberIds.filter((id) => id !== memberId)
          : [...hiddenMemberIds, memberId],
      },
    });
  }

  function toggleAllMembers() {
    if (hiddenMemberIds.length === 0) {
      dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenMemberIds: [...MEMBER_ORDER] } });
    } else {
      dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenMemberIds: [] } });
    }
  }

  // Hide a member column via the header ✕ (Outlook-style)
  function hideMember(member) {
    if (!hiddenMemberIds.includes(member.id)) {
      dispatch({ type: 'UPDATE_SETTINGS', payload: { hiddenMemberIds: [...hiddenMemberIds, member.id] } });
    }
    addToast(`${member.nameJa}を非表示にしました（再表示はメンバーチップから）`, 'info', 4000);
  }

  const filteredMembers = useMemo(() => MEMBERS.filter(m => !hiddenMemberIds.includes(m.id)), [hiddenMemberIds]);

  function handleCellDragOver(e, dateStr, memberId) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverCell(`${dateStr}|${memberId}`);
  }

  function handleCellDragLeave() {
    setDragOverCell(null);
  }

  function handleCellDrop(e, dateStr, memberId) {
    e.preventDefault();
    setDragOverCell(null);
    try {
      const jobData = JSON.parse(e.dataTransfer.getData('application/json'));
      if (onDropJob) {
        onDropJob(jobData, dateStr, memberId, '08:00', '17:00');
      }
    } catch {
      // Invalid data
    }
  }

  // Build month grid data
  const { weeks, monthLabel } = useMemo(() => {
    const allDates = getMonthDates(currentDate);
    const filteredDates = showWeekends
      ? allDates
      : allDates.filter(isBusinessDay);
    const grouped = groupByWeek(filteredDates);
    const label = `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
    return { weeks: grouped, monthLabel: label };
  }, [currentDate, showWeekends]);

  // Index events by "email|date" for fast lookup.
  // - Events already shown as an assignment (linked via outlookEventId) are
  //   skipped — same dedup as Weekly/Daily views.
  // - All-day events span [start, end) with end = next-day midnight and may
  //   cover several days (休み etc.) — index every covered date, capped at 62
  //   days so malformed data can't explode the index.
  const eventIndex = useMemo(() => {
    const idx = {};
    const linkedIds = new Set(assignments.map((a) => a.outlookEventId).filter(Boolean));
    for (const ev of events) {
      if (linkedIds.has(ev.id)) continue;
      const startStr = ev.start?.substring(0, 10);
      const email = ev.memberEmail?.toLowerCase();
      if (!startStr || !email) continue;
      const push = (dateStr) => {
        const key = `${email}|${dateStr}`;
        if (!idx[key]) idx[key] = [];
        idx[key].push(ev);
      };
      if (ev.isAllDay) {
        const endStr = ev.end ? ev.end.substring(0, 10) : startStr;
        let d = startStr;
        let guard = 0;
        do {
          push(d);
          d = addDays(d);
          guard++;
        } while (d < endStr && guard < 62);
      } else {
        push(startStr);
      }
    }
    return idx;
  }, [events, assignments]);

  // Index assignments by "memberId|date" for fast lookup (legacy isDelivery
  // records are hidden everywhere else — hide them here too)
  const assignmentIndex = useMemo(() => {
    const idx = {};
    for (const a of assignments) {
      if (!a.memberId || !a.date || a.isDelivery) continue;
      const key = `${a.memberId}|${a.date}`;
      if (!idx[key]) idx[key] = [];
      idx[key].push(a);
    }
    return idx;
  }, [assignments]);

  // Navigate to weekly view for a given week
  const handleWeekClick = useCallback(
    (weekStart) => {
      navigate('weekly', { weekStart: toISODate(weekStart) });
    },
    [navigate]
  );

  // Render cell content for a member on a given date
  const renderCell = useCallback(
    (member, dateStr) => {
      const evKey = `${member.email.toLowerCase()}|${dateStr}`;
      const memberEvents = eventIndex[evKey] || [];
      const aKey = `${member.id}|${dateStr}`;
      const memberAssignments = assignmentIndex[aKey] || [];

      // Check for status from calendar events
      let status = null;
      for (const ev of memberEvents) {
        const s = detectStatus(ev.subject || ev.title || '');
        if (s) {
          status = s;
          break;
        }
      }

      const statusType = status ? getStatusType(status) : null;

      // If status detected, show status label
      if (statusType) {
        return (
          <div
            className="px-1 py-0.5 text-center text-xs rounded"
            style={{ backgroundColor: statusType.bgColor, color: statusType.color }}
          >
            {statusType.labelJa}
          </div>
        );
      }

      const items = [];

      // Show assignments
      for (const a of memberAssignments) {
        items.push(
          <div
            key={a.id}
            className="px-1 py-0.5 text-xs rounded truncate cursor-pointer hover:opacity-80"
            style={{
              backgroundColor: member.color + '20',
              color: member.color,
              borderLeft: `2px solid ${member.color}`,
            }}
            title={a.title || a.opportunityName || ''}
            onClick={(e) => {
              e.stopPropagation();
              if (onEventClick) onEventClick(a, { date: dateStr, memberId: member.id });
            }}
          >
            {a.title || a.opportunityName || '案件'}
          </div>
        );
      }

      // Show calendar events (non-status)
      for (const ev of memberEvents) {
        const title = ev.subject || ev.title || '';
        if (detectStatus(title)) continue; // Already handled above
        items.push(
          <div
            key={ev.id}
            className="px-1 py-0.5 text-xs text-ink-muted truncate cursor-pointer hover:opacity-80"
            title={title}
            onClick={(e) => {
              e.stopPropagation();
              if (onEventClick) onEventClick(ev, { date: dateStr, memberId: member.id });
            }}
          >
            {title}
          </div>
        );
      }

      if (items.length === 0) return null;

      // Show max 2 items, then "+N" badge
      const MAX_VISIBLE = 2;
      const visible = items.slice(0, MAX_VISIBLE);
      const remaining = items.length - MAX_VISIBLE;

      return (
        <div className="space-y-0.5 overflow-hidden">
          {visible}
          {remaining > 0 && (
            <div className="text-[10px] text-ink-faint text-center">
              +{remaining}件
            </div>
          )}
        </div>
      );
    },
    [eventIndex, assignmentIndex, onEventClick]
  );

  return (
    <div className="p-2">
      {/* Month header */}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-bold text-ink">{monthLabel}</h2>
        <span className="text-sm text-ink-muted">月間スケジュール</span>
      </div>

      {/* Member filter chips */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        <button
          onClick={toggleAllMembers}
          className="text-xs px-2 py-1 rounded border border-edge hover:bg-surface-hover transition-colors"
        >
          {hiddenMemberIds.length === 0 ? '全解除' : '全選択'}
        </button>
        {MEMBERS.map((member) => (
          <label key={member.id} className="inline-flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={!hiddenMemberIds.includes(member.id)} onChange={() => toggleMember(member.id)} className="sr-only" />
            <span
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border transition-all ${
                !hiddenMemberIds.includes(member.id) ? 'border-transparent text-white' : 'border-edge text-ink-faint bg-surface'
              }`}
              style={!hiddenMemberIds.includes(member.id) ? { backgroundColor: member.color } : {}}
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: !hiddenMemberIds.includes(member.id) ? 'white' : member.color }} />
              {member.nameJa}
            </span>
          </label>
        ))}
      </div>

      {/* Scrollable table container */}
      <div className="overflow-x-auto border border-edge rounded-lg shadow-sm">
        <table className="w-full border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
          {/* Header row with member names */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-raised">
              <th className="border border-edge px-1 py-2 text-left font-medium text-ink-muted" style={{ width: '50px' }}>
                日付
              </th>
              {filteredMembers.map((member) => (
                <th
                  key={member.id}
                  className="relative group border border-edge px-1 py-2 text-center font-medium"
                  style={{
                    borderTop: `3px solid ${member.color}`,
                    color: member.color,
                  }}
                >
                  <div className="truncate">
                    {member.nameJa}
                    {member.role === 'preparation' && (
                      <span className="text-ink-faint text-[10px] block">(準備)</span>
                    )}
                  </div>
                  <HideMemberButton member={member} onHide={hideMember} />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {weeks.map((week, weekIdx) => {
              const weekLabel = `${week.weekStart.getMonth() + 1}/${week.weekStart.getDate()}〜`;
              return (
                <Fragment key={week.key} weekIdx={weekIdx}>
                  {/* Week header row */}
                  <tr
                    className="bg-canvas hover:bg-surface-hover cursor-pointer transition-colors"
                    onClick={() => handleWeekClick(week.weekStart)}
                    title="クリックで週間ビューへ"
                  >
                    <td
                      colSpan={filteredMembers.length + 1}
                      className="border border-edge px-3 py-1.5 font-semibold text-ink text-xs"
                    >
                      <span className="inline-flex items-center gap-1">
                        <svg className="w-3 h-3 text-ink-faint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        Week {weekIdx + 1} — {weekLabel}
                      </span>
                    </td>
                  </tr>

                  {/* Day rows within the week */}
                  {week.dates.map((date, dayIdx) => {
                    const dateStr = toISODate(date);
                    const dayName = getDayNameJa(date);
                    const isToday = toISODate(new Date()) === dateStr;
                    const rowBg = isToday
                      ? 'bg-accent-soft'
                      : dayIdx % 2 === 0
                        ? 'bg-surface'
                        : 'bg-weekend';

                    return (
                      <tr key={dateStr} className={`${rowBg} hover:bg-today transition-colors`}>
                        {/* Date label cell */}
                        <td
                          className={`border border-edge px-2 py-1 text-xs font-medium whitespace-nowrap ${
                            isToday ? 'text-accent font-bold' : 'text-ink'
                          }`}
                        >
                          {date.getDate()} {dayName}
                        </td>

                        {/* Member cells (drop targets) */}
                        {filteredMembers.map((member) => {
                          const cellKey = `${dateStr}|${member.id}`;
                          const isDragOver = dragOverCell === cellKey;
                          return (
                            <td
                              key={member.id}
                              className={`border border-edge px-1 py-0.5 align-top transition-colors overflow-hidden ${
                                isDragOver ? 'bg-drop ring-1 ring-inset ring-accent' : ''
                              }`}
                              onClick={() => handleWeekClick(getWeekMonday(date))}
                              onDragOver={(e) => handleCellDragOver(e, dateStr, member.id)}
                              onDragLeave={handleCellDragLeave}
                              onDrop={(e) => handleCellDrop(e, dateStr, member.id)}
                              style={{ cursor: 'pointer' }}
                            >
                              {renderCell(member, dateStr)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
        {STATUS_TYPES.map((st) => (
          <div key={st.id} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded"
              style={{ backgroundColor: st.bgColor, border: `1px solid ${st.color}` }}
            />
            <span>{st.labelJa}</span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded bg-accent-soft border border-accent" />
          <span>今日</span>
        </div>
      </div>
    </div>
  );
}

// Simple fragment wrapper to avoid React.Fragment key warning with extra props
function Fragment({ children }) {
  return <>{children}</>;
}
