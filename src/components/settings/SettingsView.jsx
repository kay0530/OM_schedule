import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { loadAzureConfig, saveAzureConfig, DEFAULT_AZURE_CONFIG } from '../../services/msalService';

/**
 * Generate time options at 30-minute intervals.
 * @param {number} startHour
 * @param {number} endHour
 * @returns {string[]}
 */
function generateTimeOptions(startHour, endHour) {
  const options = [];
  for (let h = startHour; h <= endHour; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === endHour && m > 0) break;
      options.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return options;
}

const START_TIME_OPTIONS = generateTimeOptions(6, 10);
const END_TIME_OPTIONS = generateTimeOptions(16, 20);

export default function SettingsView() {
  const { assignments, settings, dispatch } = useApp();
  const { isAuthenticated, account, login, logout, loading: authLoading } = useAuth();

  // --- Azure AD state ---
  const [clientId, setClientId] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [azureSaveMsg, setAzureSaveMsg] = useState('');
  const [connectingTest, setConnectingTest] = useState(false);

  // --- Working hours state ---
  const [workStart, setWorkStart] = useState(settings.workingHours?.start || '08:00');
  const [workEnd, setWorkEnd] = useState(settings.workingHours?.end || '18:00');
  const [showWeekends, setShowWeekends] = useState(settings.showWeekends ?? false);
  const [hoursSaveMsg, setHoursSaveMsg] = useState('');

  // --- Import file ref ---
  const fileInputRef = useRef(null);

  // --- Reset confirmation ---
  const [confirmReset, setConfirmReset] = useState(false);

  // Load Azure AD config on mount
  useEffect(() => {
    const config = loadAzureConfig();
    setClientId(config.clientId || '');
    setTenantId(config.tenantId || '');
    if (config.clientId && config.tenantId) {
      setIsConfigured(true);
    }
  }, []);

  // Sync working hours from context if settings change externally
  useEffect(() => {
    setWorkStart(settings.workingHours?.start || '08:00');
    setWorkEnd(settings.workingHours?.end || '18:00');
    setShowWeekends(settings.showWeekends ?? false);
  }, [settings]);

  // --- Azure AD handlers ---
  function handleAzureSave() {
    const trimmedClient = clientId.trim();
    const trimmedTenant = tenantId.trim();
    if (trimmedClient && trimmedTenant) {
      saveAzureConfig(trimmedClient, trimmedTenant);
      setIsConfigured(true);
      setAzureSaveMsg('設定を保存しました。変更を反映するにはページをリロードしてください。');
    } else {
      setAzureSaveMsg('Client ID と Tenant ID の両方を入力してください。');
    }
    setTimeout(() => setAzureSaveMsg(''), 5000);
  }

  async function handleTestConnection() {
    setConnectingTest(true);
    try {
      await login();
    } finally {
      setConnectingTest(false);
    }
  }

  async function handleLogout() {
    await logout();
  }

  // --- Working hours handlers ---
  function handleSaveWorkingHours() {
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: {
        workingHours: { start: workStart, end: workEnd },
        showWeekends,
      },
    });
    setHoursSaveMsg('保存しました');
    setTimeout(() => setHoursSaveMsg(''), 3000);
  }

  // --- Data management handlers ---
  function handleExportJson() {
    const data = JSON.stringify(assignments, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `construction-schedule-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportJson(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (!Array.isArray(imported)) {
          alert('無効なデータ形式です。配列を含むJSONファイルを選択してください。');
          return;
        }
        // Add each imported assignment
        for (const item of imported) {
          dispatch({ type: 'ADD_ASSIGNMENT', payload: item });
        }
        alert(`${imported.length}件のデータをインポートしました。`);
      } catch {
        alert('JSONの解析に失敗しました。ファイルを確認してください。');
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleResetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 5000);
      return;
    }
    // Clear assignments
    for (const a of assignments) {
      dispatch({ type: 'DELETE_ASSIGNMENT', payload: a.id });
    }
    // Reset settings to defaults
    dispatch({
      type: 'UPDATE_SETTINGS',
      payload: { workingHours: { start: '08:00', end: '18:00' }, showWeekends: false },
    });
    setConfirmReset(false);
  }

  // --- Salesforce sync info ---
  let sfOpportunities = [];
  try {
    sfOpportunities = JSON.parse(localStorage.getItem('construction-schedule-sf-opportunities') || '[]');
  } catch {
    // Ignore
  }
  const lastSfSync = localStorage.getItem('construction-schedule-sf-last-sync') || null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <h1 className="text-2xl font-bold text-gray-800">設定</h1>

      {/* ===== Section 1: MS365 Integration ===== */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-gray-800">MS365連携</h3>
            <p className="text-sm text-gray-500">Azure AD 設定・Outlook カレンダー同期</p>
          </div>
          <div className="ml-auto">
            {isAuthenticated ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                接続済み
              </span>
            ) : isConfigured ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700">
                <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                未接続
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                未設定
              </span>
            )}
          </div>
        </div>

        {/* Connected account info */}
        {isAuthenticated && account && (
          <div className="mb-4 flex items-center justify-between text-sm bg-green-50 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-green-700">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>{account.name || account.username} としてサインイン中</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-red-600 hover:text-red-700 font-medium"
            >
              ログアウト
            </button>
          </div>
        )}

        {/* Config input fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client ID (アプリケーション ID)
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => { setClientId(e.target.value); setAzureSaveMsg(''); }}
              placeholder={DEFAULT_AZURE_CONFIG.clientId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tenant ID (テナント ID)
            </label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => { setTenantId(e.target.value); setAzureSaveMsg(''); }}
              placeholder={DEFAULT_AZURE_CONFIG.tenantId}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleAzureSave}
              disabled={!clientId.trim() || !tenantId.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              保存
            </button>

            {isConfigured && !isAuthenticated && (
              <button
                onClick={handleTestConnection}
                disabled={connectingTest || authLoading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {connectingTest || authLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    接続中...
                  </>
                ) : (
                  '接続テスト'
                )}
              </button>
            )}

            {azureSaveMsg && (
              <span className="text-sm text-amber-600 font-medium">{azureSaveMsg}</span>
            )}
          </div>
        </div>

        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500">
            必要な権限: <span className="font-mono text-blue-600">Calendars.ReadWrite</span>, <span className="font-mono text-blue-600">Calendars.ReadWrite.Shared</span>, <span className="font-mono text-blue-600">User.Read</span>
          </p>
        </div>
      </div>


      {/* ===== Section 3: Salesforce Sync ===== */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-gray-800">Salesforce同期</h3>
            <p className="text-sm text-gray-500">商談データの同期状況</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">最終同期日</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">
                {lastSfSync ? new Date(lastSfSync).toLocaleString('ja-JP') : '未同期'}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-xs text-gray-500">商談件数</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">
                {sfOpportunities.length} 件
              </p>
            </div>
          </div>

          <div className="p-3 bg-indigo-50 rounded-lg">
            <p className="text-xs text-indigo-700 font-medium mb-1">同期方法</p>
            <p className="text-xs text-indigo-600">
              ターミナルで以下のコマンドを実行してください:
            </p>
            <code className="block mt-1 text-xs bg-white text-gray-800 px-2 py-1.5 rounded border border-indigo-200 font-mono">
              npm run sync-sf
            </code>
          </div>
        </div>
      </div>

      {/* ===== Section 4: Data Management ===== */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-gray-800">データ管理</h3>
            <p className="text-sm text-gray-500">割り当てデータのエクスポート・インポート・リセット</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Current data info */}
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-500">現在の割り当て件数</p>
            <p className="text-sm font-medium text-gray-800 mt-0.5">{assignments.length} 件</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Export button */}
            <button
              onClick={handleExportJson}
              disabled={assignments.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              JSONエクスポート
            </button>

            {/* Import button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              JSONインポート
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportJson}
              className="hidden"
            />

            {/* Reset button */}
            <button
              onClick={handleResetAll}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                confirmReset
                  ? 'text-white bg-red-600 hover:bg-red-700'
                  : 'text-red-600 bg-red-50 hover:bg-red-100'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              {confirmReset ? '本当にリセットしますか？' : '全データリセット'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
