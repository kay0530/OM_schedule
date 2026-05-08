/**
 * Work category catalog used for assignment filtering.
 * Each entry: { id, label, color }
 */
export const WORK_CATEGORIES = [
  { id: 'genchi',   label: '現地調査',   color: '#3B82F6' },
  { id: 'powamaru', label: 'パワまる工事', color: '#F97316' },
  { id: 'nenji',    label: '年次点検',   color: '#10B981' },
  { id: 'wash',     label: '洗浄',      color: '#06B6D4' },
  { id: 'kusakari', label: '草刈り',     color: '#84CC16' },
  { id: 'jizen',    label: '事前準備',   color: '#A855F7' },
  { id: 'nouhin',   label: '納品',      color: '#F59E0B' },
  { id: 'other',    label: 'その他',     color: '#6B7280' },
];

const LABEL_TO_ID = WORK_CATEGORIES.reduce((acc, c) => {
  acc[c.label] = c.id;
  return acc;
}, {});

export const WORK_CATEGORY_IDS = WORK_CATEGORIES.map((c) => c.id);

/**
 * Resolve a known category id from a free-form label.
 * Falls back to 'other' for unknown labels.
 */
export function categoryIdFromLabel(label) {
  if (!label) return null;
  return LABEL_TO_ID[label] || 'other';
}

/**
 * Extract category id from an assignment.
 * Prefers explicit `workCategory` (label) field; falls back to parsing the
 * 【...】 prefix from `opportunityName` / `title`.
 *
 * @param {object} assignment
 * @returns {string|null} category id or null if no category detected
 */
export function getAssignmentCategoryId(assignment) {
  if (!assignment) return null;
  if (assignment.isDelivery) return 'nouhin';
  if (assignment.workCategory) return categoryIdFromLabel(assignment.workCategory);
  const title = assignment.opportunityName || assignment.title || '';
  const m = title.match(/^【([^】]+)】/);
  if (m) return categoryIdFromLabel(m[1]);
  return null;
}
