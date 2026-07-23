/** Attribute toggled on <html> for the duration of a drag (see index.css). */
const ATTR = 'data-drag-passthrough';

/**
 * Let an in-flight HTML5 drag drop THROUGH the event chips onto the hour cell
 * underneath, so a schedule can be placed on top of an existing one.
 *
 * Why this is needed: chips ([data-event-block]) are absolutely-positioned
 * SIBLINGS of the hour cells that carry onDragOver/onDrop. A chip under the
 * cursor therefore swallows the drag events, nothing calls preventDefault(),
 * and the browser rejects the drop ("not-allowed" cursor) — the user sees the
 * drag bounced off every occupied slot.
 *
 * Implemented as one attribute + a CSS rule rather than per-element inline
 * styles so that chips (re)mounted mid-drag are covered too — the grid
 * re-renders on every cell the cursor crosses.
 *
 * The dragged chip itself is included: dropping onto a slot the chip already
 * covers (a short move within its own span) must work as well, and once the
 * drag has started the browser no longer hit-tests the source.
 */
export function enableDropThroughChips() {
  let active = true;

  function restore() {
    if (!active) return;
    active = false;
    document.removeEventListener('dragend', restore, true);
    document.removeEventListener('drop', restore, true);
    document.removeEventListener('mousemove', restore, true);
    document.documentElement.removeAttribute(ATTR);
  }

  // Restore on the document, not on the drag source: a successful move
  // re-parents the dragged chip into another column, which unmounts it, so a
  // React onDragEnd bound to that element may never fire — that would leave
  // every chip permanently click-dead.
  // Capture phase so a stopPropagation() in the tree cannot strand us.
  document.addEventListener('dragend', restore, true);
  document.addEventListener('drop', restore, true);

  // Deferred: mutating things synchronously inside dragstart can abort the
  // drag in Chromium (the drag image is captured at dragstart time).
  setTimeout(() => {
    if (!active) return; // drag already ended
    document.documentElement.setAttribute(ATTR, 'true');
    // Failsafe: the browser suppresses native mousemove for the duration of a
    // drag, so the first one means the drag is over — this recovers the case
    // where dragend never arrives (e.g. the source chip unmounted mid-drag).
    // Registered here, after dragstart, so a stray mousemove cannot fire it.
    document.addEventListener('mousemove', restore, true);
  }, 0);
}
