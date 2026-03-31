import { useState } from 'react';
import { timeStringToMinutes } from '../../utils/dateUtils';

/**
 * Single event block rendered on the weekly calendar grid.
 * Positioned absolutely based on start/end time within the hour grid.
 *
 * @param {{ event: object, hourHeight: number, startHour: number, memberColor?: string }}
 */
export default function EventBlock({ event, hourHeight, startHour, memberColor }) {
  const [showTooltip, setShowTooltip] = useState(false);

  // All-day events are rendered separately
  if (event.isAllDay) return null;

  // Parse start/end times
  const startTime = event.startTime || event.start?.substring(11, 16);
  const endTime = event.endTime || event.end?.substring(11, 16);
  if (!startTime || !endTime) return null;

  const startMinutes = timeStringToMinutes(startTime);
  const endMinutes = timeStringToMinutes(endTime);

  // Position relative to grid start hour
  const gridStartMinutes = startHour * 60;
  const topOffset = ((startMinutes - gridStartMinutes) / 60) * hourHeight;
  const height = ((endMinutes - startMinutes) / 60) * hourHeight;

  if (height <= 0) return null;

  // Determine event type and styling
  const isAssignment = !!event.opportunityName;
  const isStatus = !!event.statusType;

  let bgColor, borderColor, textColor;
  if (isAssignment) {
    bgColor = memberColor ? `${memberColor}33` : 'rgba(59, 130, 246, 0.2)';
    borderColor = memberColor || '#3B82F6';
    textColor = memberColor || '#3B82F6';
  } else if (isStatus) {
    bgColor = '#F3F4F6';
    borderColor = '#9CA3AF';
    textColor = '#6B7280';
  } else {
    // Outlook / calendar event
    bgColor = '#F3F4F6';
    borderColor = '#D1D5DB';
    textColor = '#374151';
  }

  const title = event.opportunityName || event.title || event.statusLabel || '';

  return (
    <div
      className="absolute left-0.5 right-0.5 rounded overflow-hidden cursor-pointer transition-shadow hover:shadow-md"
      style={{
        top: `${topOffset}px`,
        height: `${Math.max(height, 14)}px`,
        backgroundColor: bgColor,
        borderLeft: `3px solid ${borderColor}`,
        zIndex: showTooltip ? 20 : 10,
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Event title */}
      {height >= 14 && (
        <p
          className="text-[10px] font-medium leading-tight px-1 pt-0.5 truncate"
          style={{ color: textColor }}
        >
          {title}
        </p>
      )}
      {/* Time range */}
      {height >= 30 && (
        <p className="text-[9px] text-gray-400 truncate leading-tight px-1">
          {startTime}–{endTime}
        </p>
      )}

      {/* Tooltip on hover */}
      {showTooltip && (
        <div className="absolute left-full top-0 ml-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-36 pointer-events-none">
          <p className="text-xs font-semibold text-gray-800 mb-0.5">{title}</p>
          <p className="text-[11px] text-gray-500">
            {startTime} – {endTime}
          </p>
          {isAssignment && (
            <span className="inline-block mt-1 text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
              施工予定
            </span>
          )}
          {event.location && (
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">
              📍 {event.location}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
