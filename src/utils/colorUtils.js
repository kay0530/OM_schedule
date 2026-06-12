/**
 * YIQ luminance check: returns dark text for light member colors
 * (amber #F59E0B, lime #84CC16, delivery #D97706 stays white) and white
 * text otherwise, so solid event chips stay readable in both themes.
 */
export function getContrastText(hex) {
  if (!hex) return '#FFFFFF';
  const h = hex.replace('#', '');
  if (h.length < 6) return '#FFFFFF';
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#1F1F1F' : '#FFFFFF';
}
