import { useState, useMemo, useCallback } from 'react';
import { MEMBERS } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useCalendar } from '../../context/CalendarContext';
import { toISODate, getDayNameJa } from '../../utils/dateUtils';
import { STATUS_KEYWORDS, STATUS_TYPES } from '../../data/statusTypes';

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
export default function MonthlyView({ navigate, currentDate, onDropJob }) {
  const { assignments, settings } = useApp();
  const { events } = useCalendar();
  const showWeekends = settings?.showWeekends ?? false;
  const [dragOverCell, setDragOverCell] = useState(null);

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

  // Index events by "email|date" for fast lookup
  const eventIndex = useMemo(() => {
    const idx = {};
    for (const ev of events) {
      const dateStr = ev.start?.substring(0, 10);
      const email = ev.memberEmail?.toLowerCase();
      if (!dateStr || !email) continue;
      const key = `${email}|${dateStr}`;
      if (!idx[key]) idx[key] = [];
      idx[key].push(ev);
    }
    return idx;
  }, [events]);

  // Index assignments by "memberId|date" for fast lookup
  const assignmentIndex = useMemo(() => {
    const idx = {};
    for (const a of assignments) {
      if (!a.memberId || !a.date) continue;
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
            className="px-1 py-0.5 text-xs rounded truncate"
            style={{
              backgroundColor: member.color + '20',
              color: member.color,
              borderLeft: `2px solid ${member.color}`,
            }}
            title={a.title || a.opportunityName || ''}
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
            className="px-1 py-0.5 text-xs text-gray-600 truncate"
            title={title}
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
        <div className="space-y-0.5 overflow-hidden" style={{ maxWidth: '96px' }}>
          {visible}
          {remaining > 0 && (
            <div className="text-[10px] text-gray-400 text-center">
              +{remaining}件
            </div>
          )}
        </div>
      );
    },
    [eventIndex, assignmentIndex]
  );

  return (
    <div className="p-2">
      {/* Month header */}
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-bold text-gray-800">{monthLabel}</h2>
        <span className="text-sm text-gray-500">月間スケジュール</span>
      </div>

      {/* Scrollable table container */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed', width: `${60 + MEMBERS.length * 100}px` }}>
          {/* Header row with member names */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50">
              <th className="border border-gray-200 px-1 py-2 text-left font-medium text-gray-600" style={{ width: '60px' }}>
                日付
              </th>
              {MEMBERS.map((member) => (
                <th
                  key={member.id}
                  className="border border-gray-200 px-1 py-2 text-center font-medium"
                  style={{ width: '100px' }}
                  style={{
                    borderTop: `3px solid ${member.color}`,
                    color: member.color,
                  }}
                >
                  <div className="truncate">
                    {member.nameJa}
                    {member.role === 'preparation' && (
                      <span className="text-gray-400 text-[10px] block">(準備)</span>
                    )}
                  </div>
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
                    className="bg-gray-100 hover:bg-gray-200 cursor-pointer transition-colors"
                    onClick={() => handleWeekClick(week.weekStart)}
                    title="クリックで週間ビューへ"
                  >
                    <td
                      colSpan={MEMBERS.length + 1}
                      className="border border-gray-200 px-3 py-1.5 font-semibold text-gray-700 text-xs"
                    >
                      <span className="inline-flex items-center gap-1">
                        <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                      ? 'bg-blue-50'
                      : dayIdx % 2 === 0
                        ? 'bg-white'
                        : 'bg-gray-50/50';

                    return (
                      <tr key={dateStr} className={`${rowBg} hover:bg-blue-50/50 transition-colors`}>
                        {/* Date label cell */}
                        <td
                          className={`border border-gray-200 px-2 py-1 text-xs font-medium whitespace-nowrap ${
                            isToday ? 'text-blue-600 font-bold' : 'text-gray-700'
                          }`}
                        >
                          {date.getDate()} {dayName}
                        </td>

                        {/* Member cells (drop targets) */}
                        {MEMBERS.map((member) => {
                          const cellKey = `${dateStr}|${member.id}`;
                          const isDragOver = dragOverCell === cellKey;
                          return (
                            <td
                              key={member.id}
                              className={`border border-gray-200 px-1 py-0.5 align-top transition-colors overflow-hidden ${
                                isDragOver ? 'bg-blue-100 ring-1 ring-inset ring-blue-400' : ''
                              }`}
                              style={{ maxWidth: '100px' }}
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
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
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
          <span className="inline-block w-3 h-3 rounded bg-blue-50 border border-blue-300" />
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
