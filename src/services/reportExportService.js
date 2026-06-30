/**
 * Work-report export: fetch every member's Outlook events (with body), parse the
 * filled "作業報告" sections, dedup to one row per job, and produce an .xlsx for
 * the admin team (唐さん). All deterministic and local — no AI credits, just the
 * operator's existing Graph token.
 */
import { fetchMemberEventsWithBody } from './graphCalendarService';
import { parseWorkReport } from './reportParser';
import { MEMBERS } from '../data/members';

/** Output columns, in order. */
export const REPORT_COLUMNS = [
  '日付',
  '案件名',
  '記載者',
  '場所',
  '移動時間',
  '作業時間',
  '作業者名',
  '作業内容',
  '残タスク／申し送り',
  'データ格納先(Box)',
];

const COLUMN_WIDTHS = {
  '日付': 12,
  '案件名': 38,
  '記載者': 10,
  '場所': 28,
  '移動時間': 10,
  '作業時間': 16,
  '作業者名': 24,
  '作業内容': 14,
  '残タスク／申し送り': 50,
  'データ格納先(Box)': 42,
};

function eventDate(ev) {
  return (ev.start || '').substring(0, 10);
}

// Same job (same date + title, ignoring spaces and a 【…】 prefix) collapses to
// one row — the report is filled on one representative's copy but the event may
// exist on several members' calendars.
function dedupKey(ev) {
  const t = (ev.subject || '').replace(/[　\s]/g, '').replace(/【[^】]*】/g, '');
  return `${eventDate(ev)}|${t}`;
}

/**
 * Fetch all members' Outlook events with body, parse filled work reports, and
 * dedup to one row per job, sorted by date.
 * @param {() => Promise<string>} getToken
 * @param {string} startDate - 'YYYY-MM-DD'
 * @param {string} endDate - 'YYYY-MM-DD'
 * @returns {Promise<{rows:Array<Object>, errors:Array<{member:string,error:string}>, scanned:number}>}
 */
export async function collectWorkReports(getToken, startDate, endDate) {
  const token = await getToken();
  if (!token) throw new Error('MS365トークンを取得できません。再ログインしてください。');

  // 瀬戸 is on Google (skipOutlookSync) — not covered by this Outlook-only export.
  const targets = MEMBERS.filter((m) => !m.skipOutlookSync);
  const errors = [];
  const byKey = new Map();
  let scanned = 0;

  for (const m of targets) {
    const res = await fetchMemberEventsWithBody(token, m.email, startDate, endDate);
    if (!res.success) {
      errors.push({ member: m.nameJa, error: res.error });
      continue;
    }
    for (const ev of res.data) {
      scanned++;
      const report = parseWorkReport(ev.bodyText);
      if (!report || !report.filled) continue;
      const key = dedupKey(ev);
      // Prefer the most-complete copy if the report appears on several calendars.
      const score = (report.workers || '').length + (report.remaining || '').length;
      const existing = byKey.get(key);
      if (!existing || score > existing._score) {
        byKey.set(key, {
          _score: score,
          '日付': eventDate(ev),
          '案件名': ev.subject || '',
          '記載者': m.nameJa,
          '場所': ev.location || '',
          '移動時間': report.movingTime,
          '作業時間': report.workTime,
          '作業者名': report.workers,
          '作業内容': report.workContent,
          '残タスク／申し送り': report.remaining,
          'データ格納先(Box)': report.boxUrl,
        });
      }
    }
  }

  const rows = [...byKey.values()]
    .map(({ _score, ...r }) => r)
    .sort((a, b) => (a['日付'] || '').localeCompare(b['日付'] || ''));

  return { rows, errors, scanned };
}

/** Build and download an .xlsx workbook from report rows. SheetJS is loaded
 *  lazily so it never weighs down the initial bundle. */
export async function downloadReportXlsx(rows, filename) {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows, { header: REPORT_COLUMNS });
  ws['!cols'] = REPORT_COLUMNS.map((c) => ({ wch: COLUMN_WIDTHS[c] || 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '活動報告');
  XLSX.writeFile(wb, filename);
}
