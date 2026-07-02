import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCalendar } from '../../context/CalendarContext';
import { useApp } from '../../context/AppContext';
import { useCalendarSync } from '../../hooks/useCalendarSync';
import { MEMBERS } from '../../data/members';
import { getWeekDates, formatDateShort } from '../../utils/dateUtils';
import ReportExportModal from '../schedule/ReportExportModal';

/**
 * Format a date as Japanese year-month string (e.g., "2026年4月")
 */
function formatMonth(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

const THEME_CYCLE = { light: 'dark', dark: 'system', system: 'light' };
const THEME_LABELS = { light: 'ライト', dark: 'ダーク', system: 'システム連動' };

export default function Header({ activeView, onNavigate, onToggleSidebar, currentDate, onDateChange, bannerOffset = false }) {
  const { isAuthenticated, account, loading, error, login, logout, getToken } = useAuth();
  const { events, lastSynced, loading: calLoading } = useCalendar();
  const { settings, dispatch } = useApp();
  const { syncing, syncFromOutlook } = useCalendarSync();
  const [reportOpen, setReportOpen] = useState(false);

  const theme = settings.theme || 'light';
  function cycleTheme() {
    dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: THEME_CYCLE[theme] } });
  }

  // Week label as a real date range (e.g. 6/8〜6/12), Outlook-style
  function formatWeek(date) {
    const dates = getWeekDates(date);
    const visible = (settings.showWeekends ?? false)
      ? dates
      : dates.filter((d) => d.getDay() !== 0 && d.getDay() !== 6);
    return `${formatDateShort(visible[0])}〜${formatDateShort(visible[visible.length - 1])}`;
  }

  // Sync calendar events from Outlook for current month ±2 weeks
  async function handleSync() {
    if (syncing || !isAuthenticated) return;
    try {
      const token = await getToken();
      if (!token) {
        alert('トークン取得に失敗しました。再ログインしてください。');
        return;
      }
      const startDate = new Date(currentDate);
      startDate.setDate(1);
      startDate.setDate(startDate.getDate() - 14);
      const endDate = new Date(currentDate);
      endDate.setMonth(endDate.getMonth() + 1, 0);
      endDate.setDate(endDate.getDate() + 14);

      const syncableMembers = MEMBERS.filter((m) => !m.skipOutlookSync);
      const result = await syncFromOutlook(token, syncableMembers, startDate, endDate);
      if (result.success) {
        alert(`Outlook同期完了: ${result.count}件のイベントを取得しました`);
      } else if (result.errors?.length) {
        // Name WHO failed — shared-calendar errors already embed the member
        // name + remedy, so only prefix raw errors with the member's name
        const detail = result.errors
          .map((e2) => {
            const m = MEMBERS.find(
              (mm) => ((mm.outlookEmail || mm.email) || '').toLowerCase() === String(e2.member || '').toLowerCase()
            );
            const msg = e2.error || '不明なエラー';
            return m && !msg.includes(m.nameJa) ? `${m.nameJa}: ${msg}` : msg;
          })
          .join('\n');
        alert(`Outlook同期: ${result.count}件取得（一部エラー）\n${detail}\n\n失敗したメンバーの予定は前回同期時の内容を表示しています。`);
      } else {
        alert(`Outlook同期: ${result.count}件取得（一部エラー: ${result.error}）`);
      }
    } catch (err) {
      alert(`同期エラー: ${err.message}`);
    }
  }

  // Navigate to previous/next period
  function navigatePeriod(direction) {
    const newDate = new Date(currentDate);
    if (activeView === 'daily') {
      newDate.setDate(newDate.getDate() + direction);
    } else if (activeView === 'weekly') {
      newDate.setDate(newDate.getDate() + direction * 7);
    } else {
      newDate.setMonth(newDate.getMonth() + direction);
    }
    onDateChange(newDate);
  }

  // Go to today
  function goToday() {
    onDateChange(new Date());
  }

  function formatDay(date) {
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${dayNames[date.getDay()]}）`;
  }

  const periodLabel =
    activeView === 'daily' ? formatDay(currentDate)
      : activeView === 'weekly' ? formatWeek(currentDate)
        : formatMonth(currentDate);

  return (
    <>
    <header className={`h-14 bg-raised border-b border-edge flex items-center px-4 fixed ${bannerOffset ? 'top-10' : 'top-0'} left-0 right-0 z-30`}>
      {/* Mobile sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-2 rounded-lg hover:bg-surface-hover mr-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* App logo and title */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-lg font-bold text-ink hidden sm:block">O&M予定表</h1>
      </div>

      {/* Period navigation (only for calendar views) */}
      {activeView !== 'settings' && (
        <div className="flex items-center gap-2 ml-6">
          <button
            onClick={() => navigatePeriod(-1)}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-ink-muted"
            title="前へ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1 text-xs font-medium rounded-lg border border-edge text-ink-muted hover:bg-surface-hover"
          >
            今日
          </button>
          <button
            onClick={() => navigatePeriod(1)}
            className="p-1.5 rounded-lg hover:bg-surface-hover text-ink-muted"
            title="次へ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-ink ml-1 hidden sm:inline">{periodLabel}</span>
          {calLoading && (
            <svg className="w-3.5 h-3.5 animate-spin text-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
      )}

      {/* View toggle buttons */}
      {activeView !== 'settings' && (
        <div className="hidden sm:flex items-center gap-1 ml-4 bg-canvas rounded-lg p-0.5">
          <button
            onClick={() => onNavigate('monthly')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeView === 'monthly'
                ? 'bg-surface text-ink shadow-sm dark:bg-surface-hover'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            月間
          </button>
          <button
            onClick={() => onNavigate('weekly')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeView === 'weekly'
                ? 'bg-surface text-ink shadow-sm dark:bg-surface-hover'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            週間
          </button>
          <button
            onClick={() => onNavigate('daily')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeView === 'daily'
                ? 'bg-surface text-ink shadow-sm dark:bg-surface-hover'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            日別
          </button>
        </div>
      )}

      {/* Right cluster: theme toggle + MS365 connection status */}
      <div className="ml-auto flex items-center gap-2">
        {/* Theme toggle: light → dark → system */}
        <button
          onClick={cycleTheme}
          className="p-1.5 rounded-lg text-ink-muted hover:bg-surface-hover transition-colors"
          title={`テーマ: ${THEME_LABELS[theme]}（クリックで切替）`}
        >
          {theme === 'light' && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
          {theme === 'dark' && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
          {theme === 'system' && (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </button>
        {loading ? (
          <span className="text-xs text-ink-faint flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            接続中...
          </span>
        ) : error ? (
          <span className="text-xs text-red-500 max-w-[200px] truncate" title={error}>
            {error}
          </span>
        ) : isAuthenticated ? (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-xs text-ink-muted hidden sm:inline max-w-[150px] truncate">
              {account?.name || account?.username}
            </span>
            {/* Outlook sync button */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                syncing
                  ? 'border-edge text-ink-faint cursor-not-allowed'
                  : 'border-accent/40 text-accent hover:bg-accent-soft'
              }`}
              title={lastSynced ? `最終同期: ${new Date(lastSynced).toLocaleString('ja-JP')}` : 'Outlookカレンダーを同期'}
            >
              <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? '同期中...' : 'Outlook同期'}
            </button>
            {/* Activity report export */}
            <button
              onClick={() => setReportOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border border-edge text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors"
              title="活動報告をExcelで出力（管理部向け集計）"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              活動報告
            </button>
            {/* Event count badge */}
            {events.length > 0 && (
              <span className="text-xs text-ink-faint" title={`${events.length}件のOutlookイベント`}>
                ({events.length}件)
              </span>
            )}
            <button
              onClick={logout}
              className="text-xs text-ink-faint hover:text-ink-muted transition-colors"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-edge text-ink-muted hover:bg-surface-hover hover:text-ink transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            </svg>
            MS365 連携
          </button>
        )}
      </div>
    </header>
    <ReportExportModal isOpen={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}
