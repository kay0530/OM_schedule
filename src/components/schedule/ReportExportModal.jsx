import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useModalDrag } from '../../hooks/useModalDrag';
import { collectWorkReports, downloadReportXlsx } from '../../services/reportExportService';

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Activity-report export dialog. Pulls every member's Outlook events for the
 * chosen range, parses the filled 作業報告 sections, and downloads an .xlsx for
 * the admin team's aggregation.
 */
export default function ReportExportModal({ isOpen, onClose }) {
  const { getToken, isAuthenticated } = useAuth();
  const { dragOffset, handleDragHandleMouseDown } = useModalDrag();

  const now = new Date();
  const [fromDate, setFromDate] = useState(toISO(new Date(now.getFullYear(), now.getMonth(), 1)));
  const [toDate, setToDate] = useState(toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  if (!isOpen) return null;

  async function handleExport() {
    setError(null);
    setResult(null);
    if (!isAuthenticated) {
      setError('先にMS365にログインしてください。');
      return;
    }
    if (!fromDate || !toDate) {
      setError('期間を指定してください。');
      return;
    }
    if (fromDate > toDate) {
      setError('開始日が終了日より後になっています。');
      return;
    }
    setLoading(true);
    try {
      const { rows, errors, scanned } = await collectWorkReports(getToken, fromDate, toDate);
      if (rows.length > 0) {
        await downloadReportXlsx(rows, `活動報告_${fromDate}_${toDate}.xlsx`);
      }
      setResult({ count: rows.length, scanned, errors });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-raised text-ink rounded-xl shadow-2xl w-full max-w-md pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        >
          {/* Header (drag to move) */}
          <div
            className="flex items-center justify-between px-5 py-3 border-b border-edge cursor-move select-none"
            onMouseDown={handleDragHandleMouseDown}
            title="ドラッグで移動"
          >
            <h2 className="text-base font-bold text-ink">活動報告エクスポート</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-hover">
              <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            <p className="text-xs text-ink-muted">
              全メンバーのOutlook予定から、本文の作業報告（記入済みのみ）を集計してExcelでダウンロードします。
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">開始日</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 border border-edge rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">終了日</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-3 py-2 border border-edge rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-500/10 rounded-lg px-3 py-2 whitespace-pre-wrap">
                {error}
              </div>
            )}

            {result && (
              <div className="text-sm bg-canvas rounded-lg px-3 py-2 space-y-1">
                {result.count > 0 ? (
                  <p className="text-green-700 dark:text-green-300 font-medium">
                    {result.count}件の作業報告をダウンロードしました（{result.scanned}件の予定を走査）。
                  </p>
                ) : (
                  <p className="text-ink-muted">
                    記入済みの作業報告が見つかりませんでした（{result.scanned}件の予定を走査）。
                  </p>
                )}
                {result.errors.length > 0 && (
                  <p className="text-amber-600 text-xs">
                    一部取得失敗: {result.errors.map((e) => e.member).join('、')}
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-ink-muted bg-canvas hover:bg-surface-hover rounded-lg"
              >
                閉じる
              </button>
              <button
                onClick={handleExport}
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    集計中...
                  </>
                ) : (
                  'Excelダウンロード'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
