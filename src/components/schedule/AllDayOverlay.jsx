/**
 * Full-column highlight for all-day items, mimicking Outlook's "fills the
 * whole day" look. Rendered as a translucent member-colored band spanning the
 * entire day column, behind timed events. Pointer-events-none so it never
 * blocks clicking empty time slots — the labelled, clickable chip lives in the
 * 終日 banner row above the grid.
 *
 * @param {{
 *   items: Array<{ id: string, color: string, draft?: boolean }>,
 *   totalHeight: number,
 * }}
 */
export default function AllDayOverlay({ items, totalHeight }) {
  if (!items || items.length === 0) return null;
  const count = items.length;

  return (
    <>
      {items.map((it, idx) => (
        <div
          key={it.id}
          className="absolute top-0 pointer-events-none"
          style={{
            height: `${totalHeight}px`,
            left: `${(idx / count) * 100}%`,
            width: `${100 / count}%`,
            backgroundColor: `${it.color}1f`,
            borderLeft: `3px ${it.draft ? 'dashed' : 'solid'} ${it.color}`,
            backgroundImage: it.draft
              ? `repeating-linear-gradient(135deg, transparent, transparent 5px, ${it.color}12 5px, ${it.color}12 10px)`
              : undefined,
            zIndex: 6,
          }}
        />
      ))}
    </>
  );
}
