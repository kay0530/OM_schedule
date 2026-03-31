import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCalendar } from '../../context/CalendarContext';
import { useCalendarSync } from '../../hooks/useCalendarSync';
import { MEMBERS } from '../../data/members';

/**
 * Format a date as Japanese year-month string (e.g., "2026年4月")
 */
function formatMonth(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

/**
 * Format a date as Japanese week string (e.g., "2026年4月 第1週")
 */
function formatWeek(date) {
  const weekNum = Math.ceil(date.getDate() / 7);
  return `${date.getFullYear()}年${date.getMonth() + 1}月 第${weekNum}週`;
}

export default function Header({ activeView, onNavigate, onToggleSidebar, currentDate, onDateChange }) {
  const { isAuthenticated, account, loading, error, login, logout, getToken } = useAuth();
  const { events, lastSynced } = useCalendar();
  const { syncing, syncFromOutlook, syncStatus } = useCalendarSync();

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
    if (activeView === 'weekly') {
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

  const periodLabel =
    activeView === 'weekly' ? formatWeek(currentDate) : formatMonth(currentDate);

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 fixed top-0 left-0 right-0 z-30">
      {/* Mobile sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="lg:hidden p-2 rounded-lg hover:bg-gray-100 mr-2"
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
        <h1 className="text-lg font-bold text-gray-800 hidden sm:block">パワまる工事予定表</h1>
      </div>

      {/* Period navigation (only for calendar views) */}
      {activeView !== 'settings' && (
        <div className="flex items-center gap-2 ml-6">
          <button
            onClick={() => navigatePeriod(-1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            title="前へ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={goToday}
            className="px-3 py-1 text-xs font-medium rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            今日
          </button>
          <button
            onClick={() => navigatePeriod(1)}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            title="次へ"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-700 ml-1">{periodLabel}</span>
        </div>
      )}

      {/* View toggle buttons */}
      {activeView !== 'settings' && (
        <div className="hidden sm:flex items-center gap-1 ml-4 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => onNavigate('monthly')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeView === 'monthly'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            月間
          </button>
          <button
            onClick={() => onNavigate('weekly')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeView === 'weekly'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            週間
          </button>
        </div>
      )}

      {/* MS365 connection status */}
      <div className="ml-auto flex items-center">
        {loading ? (
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
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
            <span className="text-xs text-gray-600 hidden sm:inline max-w-[150px] truncate">
              {account?.name || account?.username}
            </span>
            {/* Outlook sync button */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                syncing
                  ? 'border-gray-200 text-gray-400 cursor-not-allowed'
                  : 'border-blue-300 text-blue-600 hover:bg-blue-50'
              }`}
              title={lastSynced ? `最終同期: ${new Date(lastSynced).toLocaleString('ja-JP')}` : 'Outlookカレンダーを同期'}
            >
              <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {syncing ? '同期中...' : 'Outlook同期'}
            </button>
            {/* Event count badge */}
            {events.length > 0 && (
              <span className="text-xs text-gray-400" title={`${events.length}件のOutlookイベント`}>
                ({events.length}件)
              </span>
            )}
            <button
              onClick={logout}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            </svg>
            MS365 連携
          </button>
        )}
      </div>
    </header>
  );
}
