import { useState, useRef } from 'react';

/**
 * Drag-to-move behavior for modal dialogs.
 * Attach `onMouseDown={handleDragHandleMouseDown}` to the modal's header
 * (give it cursor-move select-none) and spread
 * `style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}`
 * on the panel. Call `resetDrag()` when the modal (re)opens.
 * Clicks on interactive elements inside the handle are ignored.
 */
export function useModalDrag() {
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef(null);

  function handleDragHandleMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragOffset.x,
      origY: dragOffset.y,
    };
    function onMove(ev) {
      const s = dragStartRef.current;
      if (!s) return;
      setDragOffset({ x: s.origX + (ev.clientX - s.startX), y: s.origY + (ev.clientY - s.startY) });
    }
    function onUp() {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function resetDrag() {
    setDragOffset({ x: 0, y: 0 });
  }

  return { dragOffset, handleDragHandleMouseDown, resetDrag };
}
