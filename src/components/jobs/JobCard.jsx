/**
 * Individual job card displayed within the JobPanel.
 * Supports both opportunity (レンタル商談) and maintenance (点検／修繕) records.
 */

// Stage color mapping by prefix number (for opportunities)
export const STAGE_COLORS = {
  '00': { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  '01': { bg: 'bg-blue-200', text: 'text-blue-900', border: 'border-blue-400' },
  '02': { bg: 'bg-sky-100', text: 'text-sky-800', border: 'border-sky-300' },
  '03': { bg: 'bg-sky-200', text: 'text-sky-900', border: 'border-sky-400' },
  '04': { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  '05': { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
  '06': { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  '07': { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  '08': { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  '09': { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  '10': { bg: 'bg-violet-100', text: 'text-violet-800', border: 'border-violet-300' },
};

// Maintenance status color mapping
export const MAINT_STATUS_COLORS = {
  '未対応': { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' },
  '見積作成': { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  '回答待ち': { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' },
  '受発注処理': { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' },
  'スケジュール調整': { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
  '実施待ち': { bg: 'bg-cyan-100', text: 'text-cyan-800', border: 'border-cyan-300' },
  '点検完了／報告書作成': { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' },
  '報告書／請求書送付': { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300' },
  '最終確認': { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  '経過観察': { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-300' },
};

// Maintenance category color mapping
export const MAINT_CATEGORY_COLORS = {
  '定期点検': 'bg-blue-500',
  '一回点検': 'bg-sky-500',
  '駆け付け点検（有償）': 'bg-red-500',
  '駆け付け点検（無償）': 'bg-red-400',
  'パネル洗浄': 'bg-cyan-500',
  'パネル破損': 'bg-orange-500',
  'パネル異常': 'bg-amber-500',
  '機器故障（PCS）': 'bg-rose-500',
  '機器故障（ESS）': 'bg-rose-400',
  '撤去・脱着': 'bg-gray-500',
  '除草': 'bg-green-500',
  'その他': 'bg-gray-400',
};

function getBadgeClasses(item) {
  if (item.type === 'maintenance') {
    const colors = MAINT_STATUS_COLORS[item.status] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' };
    return `${colors.bg} ${colors.text} ${colors.border}`;
  }
  const prefix = item.stage?.substring(0, 2) || '';
  const colors = STAGE_COLORS[prefix] || { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300' };
  return `${colors.bg} ${colors.text} ${colors.border}`;
}

export default function JobCard({ opportunity: item, onSelect }) {
  const isMaint = item.type === 'maintenance';

  function handleDragStart(e) {
    e.dataTransfer.setData('application/json', JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copyMove';
    // Delay disabling so the drag source remains interactive during dragStart
    setTimeout(() => {
      // Disable EventBlocks so drops reach slot divs underneath
      document.querySelectorAll('[data-event-block]').forEach((el) => {
        el.style.pointerEvents = 'none';
      });
    }, 0);
  }

  function handleDragEnd() {
    // Restore EventBlocks
    document.querySelectorAll('[data-event-block]').forEach((el) => {
      el.style.pointerEvents = '';
    });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => onSelect(item)}
      onKeyDown={(e) => { if (e.key === 'Enter') onSelect(item); }}
      className="w-full text-left p-3 rounded-lg border border-gray-200 hover:border-blue-400 hover:shadow-sm bg-white transition-all cursor-grab active:cursor-grabbing group"
    >
      {/* Name */}
      <p className="font-semibold text-sm text-gray-900 truncate group-hover:text-blue-700">
        {item.name}
      </p>

      {/* Summary or Account name */}
      {isMaint ? (
        item.summary && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{item.summary}</p>
        )
      ) : (
        item.accountName && (
          <p className="text-xs text-gray-500 mt-0.5 truncate">{item.accountName}</p>
        )
      )}

      {/* Badge and date row */}
      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {/* Status/Stage badge */}
        <span className={`inline-block text-xs px-2 py-0.5 rounded-full border font-medium ${getBadgeClasses(item)}`}>
          {isMaint ? item.status : item.stage}
        </span>

        {/* Category badge (maintenance only) */}
        {isMaint && item.category && (
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full text-white font-medium ${MAINT_CATEGORY_COLORS[item.category] || 'bg-gray-400'}`}>
            {item.category}
          </span>
        )}

        {/* Date */}
        {(isMaint ? item.scheduledDate : item.constructionDate) && (
          <span className="text-xs text-gray-500">
            📅 {isMaint ? item.scheduledDate : item.constructionDate}
          </span>
        )}

        {/* Confirmed indicator */}
        {isMaint && item.dateConfirmed && (
          <span className="text-xs text-green-600 font-medium">✓確定</span>
        )}
      </div>

      {/* Address */}
      {item.address && (
        <p className="text-xs text-gray-400 mt-1 truncate">{item.address}</p>
      )}
    </div>
  );
}
