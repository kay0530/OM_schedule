/**
 * Construction team member definitions.
 * Each member has a unique ID, display names, email, color for the calendar, and role.
 */
export const MEMBERS = [
  { id: 'hiroki_n', nameJa: '廣木', nameEn: 'Hiroki', email: 'norifumi.hiroki@altenergy.co.jp', color: '#3B82F6', role: 'regular' },
  { id: 'yodogawa_t', nameJa: '淀川', nameEn: 'Yodogawa', email: 'taichi.yodogawa@altenergy.co.jp', color: '#06B6D4', role: 'regular' },
  { id: 'tano_h', nameJa: '田野', nameEn: 'Tano', email: 'hayato.tano@altenergy.co.jp', color: '#10B981', role: 'regular' },
  { id: 'bold_j', nameJa: 'BOLD', nameEn: 'Bold', email: 'jigjidsuren.bold@altenergy.co.jp', color: '#F97316', role: 'regular' },
  { id: 'sasanuma_k', nameJa: '笹沼', nameEn: 'Sasanuma', email: 'kazuhiro.sasanuma@altenergy.co.jp', color: '#F59E0B', role: 'regular' },
  { id: 'yamazaki_k', nameJa: '山崎', nameEn: 'Yamazaki', email: 'kaito.yamazaki@altenergy.co.jp', color: '#EC4899', role: 'regular' },
  { id: 'ota_t', nameJa: '太田', nameEn: 'Ota', email: 'takahiro.ota@altenergy.co.jp', color: '#EF4444', role: 'regular' },
  { id: 'wano_t', nameJa: '和埜', nameEn: 'Wano', email: 'tatsuto.wano@altenergy.co.jp', color: '#8B5CF6', role: 'regular' },
  // 瀬戸 is not a tenant user; his schedule lives on a personal-account calendar
  // shared into the operator's Outlook. Route his read/write to that shared
  // calendar (resolved at runtime by this owner address) instead of /users/{email}.
  { id: 'seto_r', nameJa: '瀬戸', nameEn: 'Seto', email: 'nstandard.info@gmail.com', color: '#14B8A6', role: 'regular', sharedCalendarOwner: 'outlook_8390B1F083584B14@outlook.com' },
  { id: 'tago_s', nameJa: '田子', nameEn: 'Tago', email: 'shoichiro.tago@altenergy.co.jp', color: '#A855F7', role: 'preparation' },
  { id: 'delivery', nameJa: '納品', nameEn: 'Delivery', email: 'powermaru@altenergy.co.jp', color: '#D97706', role: 'delivery' },
];

export const MEMBER_ORDER = MEMBERS.map(m => m.id);
