import { useState, useRef, useCallback } from 'react';
import { timeStringToMinutes, minutesToTimeString } from '../../utils/dateUtils';
import { getContrastText } from '../../utils/colorUtils';
import { enableDropThroughChips } from '../../utils/dragPassthrough';

/**
 * Single event block rendered on the weekly calendar grid.
 * Positioned absolutely based on start/end time within the hour grid.
 * Supports drag-to-move and Outlook-style resize (top AND bottom edges) for
 * assignment events — dragging an edge stretches/shrinks the block live with
 * 30-min snapping, then commits via onResizeEnd.
 *
 * @param {{ event: object, hourHeight: number, startHour: number, memberColor?: string, onClick?: (event) => void, onResizeEnd?: (event, changes: {startTime?: string, endTime?: string}) => void }}
 */
export default function EventBlock({ event, hourHeight, startHour, memberColor, onClick, onDoubleClick, onResizeEnd, isActive, colorOutlook = true, laneIndex = 0, laneCount = 1 }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [resizeDeltaPx, setResizeDeltaPx] = useState(0);
  const [resizeEdge, setResizeEdge] = useState(null); // 'top' | 'bottom' | null
  const isResizing = resizeEdge !== null;
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
  // For manual assignments, "synced to Outlook" = has an outlookEventId
  const isSyncedToOutlook = isAssignment && !!event.outlookEventId;
  const isDraftOnly = isAssignment && !event.outlookEventId;

  // Chip styling class (see index.css):
  //   event-solid   = Outlook-style member-colored fill + contrast text
  //   event-tint    = draft (not synced) assignment: tint + dashed + hatch
  //   event-neutral = status events / colorless Outlook events
  let chipClass;
  if (isStatus) chipClass = 'event-neutral';
  else if (isAssignment) chipClass = isDraftOnly ? 'event-tint' : 'event-solid';
  else chipClass = colorOutlook && memberColor ? 'event-solid' : 'event-neutral';

  const mc = memberColor || '#3B82F6';
  const chipVars = chipClass === 'event-neutral'
    ? {}
    : { '--mc': mc, '--on-mc': getContrastText(mc) };

  const title = event.opportunityName || event.title || event.statusLabel || '';

  // Apply the live resize delta to the block geometry: dragging the top edge
  // moves the top AND shrinks/grows the height, the bottom edge only the height
  const minHeightPx = hourHeight / 2; // 30-min minimum duration
  const liveTop = topOffset + (resizeEdge === 'top' ? resizeDeltaPx : 0);
  const height = Math.max(
    baseHeight + (resizeEdge === 'top' ? -resizeDeltaPx : resizeEdge === 'bottom' ? resizeDeltaPx : 0),
    minHeightPx
  );

  // Live time labels while resizing (Outlook shows the changing time)
  const resizeDeltaMin = Math.round((resizeDeltaPx / hourHeight) * 60);
  const displayStartTime = resizeEdge === 'top' ? minutesToTimeString(startMinutes + resizeDeltaMin) : startTime;
  const displayEndTime = resizeEdge === 'bottom' ? minutesToTimeString(endMinutes + resizeDeltaMin) : endTime;

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
    // Without this the drop is rejected whenever the target slot already has
    // an event on it — the covering chip swallows dragover/drop.
    enableDropThroughChips();
  }

  // Resize handlers (top/bottom edges, assignments only). The delta is
  // snapped to 30-min steps and clamped LIVE so the preview never inverts,
  // never leaves the 00:00–24:00 grid, and keeps a 30-min minimum duration.
  const startResize = useCallback((edge) => (e) => {
    if (!isAssignment) return;
    e.stopPropagation();
    e.preventDefault(); // also blocks the parent's HTML5 drag from this press
    setResizeEdge(edge);
    setResizeDeltaPx(0);
    resizeStartY.current = e.clientY;

    const minH = hourHeight / 2;
    const snapSize = hourHeight / 2;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    // Sub-30min events exist (reconcile copies Outlook-edited times verbatim):
    // floor the shrink allowance at 0 or the clamp bounds invert and a bare
    // click on a handle would commit a time change (or a negative startTime).
    const maxShrink = Math.max(baseHeight - minH, 0);
    const computeSnapped = (clientY) => {
      const snapped = Math.round((clientY - resizeStartY.current) / snapSize) * snapSize;
      return edge === 'top'
        // top edge: not above the grid start, keep >= 30min duration
        ? clamp(snapped, -topOffset, maxShrink)
        // bottom edge: keep >= 30min duration, not past 24:00
        : clamp(snapped, -maxShrink, ((24 * 60 - endMinutes) / 60) * hourHeight);
    };

    function onMouseMove(moveEvent) {
      setResizeDeltaPx(computeSnapped(moveEvent.clientY));
    }

    function onMouseUp(upEvent) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const deltaMinutes = Math.round((computeSnapped(upEvent.clientY) / hourHeight) * 60);
      setResizeDeltaPx(0);
      setResizeEdge(null);
      if (deltaMinutes !== 0 && onResizeEnd) {
        if (edge === 'top') {
          onResizeEnd(event, { startTime: minutesToTimeString(startMinutes + deltaMinutes) });
        } else {
          onResizeEnd(event, { endTime: minutesToTimeString(endMinutes + deltaMinutes) });
        }
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [isAssignment, hourHeight, topOffset, baseHeight, endMinutes, startMinutes, event, onResizeEnd]);

  // NOTE: never add filter-based hover effects (hover:brightness etc.) to
  // this element — a CSS filter on the dragged element makes Chromium abort
  // HTML5 drag immediately, breaking drag-to-move.
  return (
    <div
      ref={blockRef}
      data-event-block="true"
      className={`absolute rounded overflow-hidden cursor-pointer transition-shadow hover:shadow-md ${chipClass} ${
        isResizing ? 'opacity-80 shadow-lg' : ''
      } ${isDraggable ? 'select-none' : ''} ${isActive ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : ''}`}
      title={`${title}${startTime && endTime ? ` (${startTime}–${endTime})` : ''}${event.location ? `\n📍 ${event.location}` : ''}${isAssignment ? (isSyncedToOutlook ? '\n✓ Outlook送信済み' : '\n仮（未送信）') : ''}`}
      style={{
        top: `${liveTop}px`,
        height: `${Math.max(height, 14)}px`,
        // Lane-based horizontal layout when events overlap
        left: laneCount > 1 ? `calc(${(laneIndex / laneCount) * 100}% + 1px)` : '2px',
        width: laneCount > 1 ? `calc(${100 / laneCount}% - 2px)` : 'calc(100% - 4px)',
        ...chipVars,
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
      {/* Sync status badge (assignments only) — semantic colors, intentionally fixed */}
      {isAssignment && height >= 14 && (
        <span
          className={`absolute top-0.5 right-0.5 text-[8px] leading-none px-1 py-px rounded font-bold ring-1 ring-white/40 ${
            isSyncedToOutlook
              ? 'bg-emerald-600 text-white'
              : 'bg-amber-400 text-amber-900'
          }`}
          title={isSyncedToOutlook ? 'Outlook送信済み' : '仮（未送信）'}
        >
          {isSyncedToOutlook ? '✓' : '仮'}
        </span>
      )}

      {/* Event title (color inherits from chip class) */}
      {height >= 14 && (
        <p
          className="text-[10px] font-semibold leading-tight px-1 pt-0.5 truncate"
          style={{ paddingRight: isAssignment ? '14px' : undefined }}
        >
          {title}
        </p>
      )}
      {/* Time range (live preview while resizing) */}
      {height >= 30 && (
        <p className={`text-[9px] truncate leading-tight px-1 ${isResizing ? 'font-bold opacity-100' : 'opacity-75'}`}>
          {displayStartTime}–{displayEndTime}
        </p>
      )}

      {/* Resize handles at top/bottom edges (assignments only) — Outlook
          style: subtle strips, emphasized while the event is active/selected */}
      {isDraggable && height >= 28 && (
        <div
          className={`absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-black/15 transition-colors ${
            isActive || resizeEdge === 'top' ? 'bg-black/10' : ''
          }`}
          onMouseDown={startResize('top')}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          title="ドラッグで開始時間を変更"
        >
          {(isActive || isResizing) && (
            <div className="mx-auto mt-0.5 w-4 h-0.5 rounded-full bg-current opacity-60" />
          )}
        </div>
      )}
      {isDraggable && height >= 20 && (
        <div
          className={`absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-black/15 transition-colors ${
            isActive || resizeEdge === 'bottom' ? 'bg-black/10' : ''
          }`}
          onMouseDown={startResize('bottom')}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          title="ドラッグで終了時間を変更"
        >
          <div className="mx-auto mt-0.5 w-4 h-0.5 rounded-full bg-current opacity-50" />
        </div>
      )}

      {/* Tooltip on hover */}
      {showTooltip && !isResizing && (
        <div className="absolute left-full top-0 ml-1 z-50 bg-raised border border-edge rounded-lg shadow-lg p-2 min-w-36 pointer-events-none">
          <p className="text-xs font-semibold text-ink mb-0.5">{title}</p>
          <p className="text-[11px] text-ink-muted">
            {startTime} – {endTime}
          </p>
          {isAssignment && (
            <span className="inline-block mt-1 text-[10px] bg-accent-soft text-accent px-1.5 py-0.5 rounded mr-1">
              施工予定
            </span>
          )}
          {isAssignment && (
            <span
              className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded ${
                isSyncedToOutlook
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
              }`}
            >
              {isSyncedToOutlook ? '✓ Outlook送信済み' : '仮（未送信）'}
            </span>
          )}
          {isDraggable && (
            <p className="text-[9px] text-ink-faint mt-1">ドラッグで移動可</p>
          )}
          {event.location && (
            <p className="text-[10px] text-ink-faint mt-0.5 truncate">
              📍 {event.location}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
