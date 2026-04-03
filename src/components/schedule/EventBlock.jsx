import { useState, useRef, useCallback } from 'react';
import { timeStringToMinutes } from '../../utils/dateUtils';

/**
 * Single event block rendered on the weekly calendar grid.
 * Positioned absolutely based on start/end time within the hour grid.
 * Supports drag-to-move and resize (bottom edge) for assignment events.
 *
 * @param {{ event: object, hourHeight: number, startHour: number, memberColor?: string, onClick?: (event) => void, onResizeEnd?: (event, newEndTime: string) => void }}
 */
export default function EventBlock({ event, hourHeight, startHour, memberColor, onClick, onDoubleClick, onResizeEnd, isActive }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [resizeDeltaPx, setResizeDeltaPx] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartY = useRef(null);
  const blockRef = useRef(null);

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
  const baseHeight = ((endMinutes - startMinutes) / 60) * hourHeight;

  if (baseHeight <= 0) return null;

  // Determine event type and styling
  const isAssignment = !!event.opportunityName;
  const isStatus = !!event.statusType;
  const isDraggable = isAssignment; // Only assignments are draggable

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

  // Apply resize delta to height
  const height = Math.max(baseHeight + resizeDeltaPx, hourHeight / 2); // min 30min

  // Drag-to-move handlers (HTML5 drag & drop, assignments only)
  function handleDragStart(e) {
    if (!isDraggable || isResizing) {
      e.preventDefault();
      return;
    }
    // Store event data for move operation
    const dragData = {
      type: 'event-move',
      eventId: event.id,
      originalDate: event.date,
      originalStartTime: event.startTime,
      originalEndTime: event.endTime,
      originalMemberId: event.memberId,
      durationMinutes: endMinutes - startMinutes,
      // Include full event for reference
      event: event,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
    // Semi-transparent ghost
    if (blockRef.current) {
      e.dataTransfer.setDragImage(blockRef.current, 10, 10);
    }
  }

  // Resize handlers (bottom edge, assignments only)
  const handleResizeMouseDown = useCallback((e) => {
    if (!isAssignment) return;
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartY.current = e.clientY;

    function onMouseMove(moveEvent) {
      const deltaY = moveEvent.clientY - resizeStartY.current;
      // Snap to 30-min intervals (half hourHeight)
      const snapSize = hourHeight / 2;
      const snappedDelta = Math.round(deltaY / snapSize) * snapSize;
      setResizeDeltaPx(snappedDelta);
    }

    function onMouseUp(upEvent) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      const deltaY = upEvent.clientY - resizeStartY.current;
      const snapSize = hourHeight / 2;
      const snappedDelta = Math.round(deltaY / snapSize) * snapSize;

      // Calculate new end time
      const deltaMinutes = (snappedDelta / hourHeight) * 60;
      const newEndMinutes = Math.max(endMinutes + deltaMinutes, startMinutes + 30); // min 30min
      const clampedEnd = Math.min(newEndMinutes, 19 * 60); // max 19:00
      const newEndHour = Math.floor(clampedEnd / 60);
      const newEndMin = clampedEnd % 60;
      const newEndTime = `${String(newEndHour).padStart(2, '0')}:${String(newEndMin).padStart(2, '0')}`;

      setResizeDeltaPx(0);
      setIsResizing(false);

      if (newEndTime !== endTime && onResizeEnd) {
        onResizeEnd(event, newEndTime);
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isAssignment, hourHeight, endMinutes, startMinutes, endTime, event, onResizeEnd]);

  return (
    <div
      ref={blockRef}
      data-event-block="true"
      className={`absolute left-0.5 right-0.5 rounded overflow-hidden cursor-pointer transition-shadow hover:shadow-md ${
        isResizing ? 'opacity-80 shadow-lg' : ''
      } ${isDraggable ? 'select-none' : ''} ${isActive ? 'ring-2 ring-blue-500 shadow-md' : ''}`}
      style={{
        top: `${topOffset}px`,
        height: `${Math.max(height, 14)}px`,
        backgroundColor: bgColor,
        borderLeft: `3px solid ${borderColor}`,
        zIndex: showTooltip || isResizing ? 20 : 10,
      }}
      draggable={isDraggable && !isResizing}
      onDragStart={handleDragStart}
      onClick={(e) => {
        if (isResizing) return;
        e.stopPropagation();
        if (onClick) onClick(event);
      }}
      onDoubleClick={(e) => {
        if (isResizing) return;
        e.stopPropagation();
        if (onDoubleClick) onDoubleClick(event);
      }}
      onMouseEnter={() => !isResizing && setShowTooltip(true)}
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

      {/* Resize handle at bottom edge (assignments only) */}
      {isDraggable && height >= 20 && (
        <div
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-black/10 transition-colors"
          onMouseDown={handleResizeMouseDown}
          onClick={(e) => e.stopPropagation()}
          title="ドラッグでリサイズ"
        >
          <div className="mx-auto mt-0.5 w-4 h-0.5 rounded-full bg-gray-400/50" />
        </div>
      )}

      {/* Tooltip on hover */}
      {showTooltip && !isResizing && (
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
          {isDraggable && (
            <p className="text-[9px] text-gray-400 mt-1">ドラッグで移動可</p>
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
