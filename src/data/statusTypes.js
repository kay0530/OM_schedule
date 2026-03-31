/**
 * Status type definitions for calendar events.
 * Used to categorize member availability on the construction schedule.
 */
export const STATUS_TYPES = [
  { id: 'unavailable', labelJa: '不可', color: '#9CA3AF', bgColor: '#F3F4F6' },
  { id: 'dayOff', labelJa: '休み', color: '#6B7280', bgColor: '#E5E7EB' },
  { id: 'travel', labelJa: '移動', color: '#3B82F6', bgColor: '#DBEAFE' },
  { id: 'onSite', labelJa: '現場', color: '#10B981', bgColor: '#D1FAE5' },
];

// Keywords to detect status from Outlook event titles
export const STATUS_KEYWORDS = {
  unavailable: ['不可', '不在'],
  dayOff: ['休み', '有休', '休暇', '代休'],
  travel: ['移動'],
  onSite: ['現場'],
};
