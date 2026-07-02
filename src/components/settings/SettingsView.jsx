import { useState, useEffect, useRef } from 'react';
import { useApp, ASSIGNMENT_RETENTION_DAYS } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { loadAzureConfig, saveAzureConfig, DEFAULT_AZURE_CONFIG } from '../../services/msalService';
import { getGithubToken, saveGithubToken } from '../../services/githubSyncService';
import { useSfData } from '../../context/SfDataContext';

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

  // --- GitHub token for manual SF sync (per-device, localStorage) ---
  const [githubToken, setGithubTokenInput] = useState(() => getGithubToken());
  const [githubTokenMsg, setGithubTokenMsg] = useState('');

  function handleSaveGithubToken() {
    saveGithubToken(githubToken);
    setGithubTokenMsg(githubToken.trim() ? 'トークンを保存しました（この端末のみ）' : 'トークンを削除しました');
    setTimeout(() => setGithubTokenMsg(''), 4000);
  }

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

  // --- Salesforce sync info (Firestore meta document) ---
  const { syncMeta } = useSfData();
  const lastSfSync = syncMeta?.syncedAt || null;
  const sfRecordCount = syncMeta
    ? (syncMeta.opportunityCount || 0) + (syncMeta.selfConsumptionCount || 0) + (syncMeta.maintenanceCount || 0)
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 p-4">
      <h1 className="text-2xl font-bold text-ink">設定</h1>

      {/* ===== Section 0: Display Theme ===== */}
      <div className="bg-raised rounded-xl border border-edge p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-accent-soft rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-ink">表示テーマ</h3>
            <p className="text-sm text-ink-muted">この端末のみに適用される表示設定です</p>
          </div>
        </div>
        <div className="flex gap-3 flex-wrap">
          {[
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
            { value: 'system', label: 'システムに合わせる' },
          ].map((opt) => (
            <label
              key={opt.value}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer text-sm transition ${
                (settings.theme || 'light') === opt.value
                  ? 'border-accent bg-accent-soft text-accent font-medium ring-1 ring-accent'
                  : 'border-edge bg-surface text-ink-muted hover:bg-surface-hover'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={opt.value}
                checked={(settings.theme || 'light') === opt.value}
                onChange={() => dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: opt.value } })}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* ===== Section 1: MS365 Integration ===== */}
      <div className="bg-raised rounded-xl border border-edge p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-accent-soft rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-ink">MS365連携</h3>
            <p className="text-sm text-ink-muted">Azure AD 設定・Outlook カレンダー同期</p>
          </div>
          <div className="ml-auto">
            {isAuthenticated ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-300">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                接続済み
              </span>
            ) : isConfigured ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300">
                <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full" />
                未接続
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-canvas text-ink-muted">
                <span className="w-1.5 h-1.5 bg-ink-faint rounded-full" />
                未設定
              </span>
            )}
          </div>
        </div>

        {/* Connected account info */}
        {isAuthenticated && account && (
          <div className="mb-4 flex items-center justify-between text-sm bg-green-50 dark:bg-green-500/15 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
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
            <label className="block text-sm font-medium text-ink mb-1">
              Client ID (アプリケーション ID)
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => { setClientId(e.target.value); setAzureSaveMsg(''); }}
              placeholder={DEFAULT_AZURE_CONFIG.clientId}
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Tenant ID (テナント ID)
            </label>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => { setTenantId(e.target.value); setAzureSaveMsg(''); }}
              placeholder={DEFAULT_AZURE_CONFIG.tenantId}
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent font-mono"
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
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-accent bg-accent-soft rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50"
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

        <div className="mt-4 p-3 bg-canvas rounded-lg">
          <p className="text-xs text-ink-muted">
            必要な権限: <span className="font-mono text-accent">Calendars.ReadWrite</span>, <span className="font-mono text-accent">Calendars.ReadWrite.Shared</span>, <span className="font-mono text-accent">User.Read</span>
          </p>
        </div>
      </div>


      {/* ===== Section 3: Salesforce Sync ===== */}
      <div className="bg-raised rounded-xl border border-edge p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-ink">Salesforce同期</h3>
            <p className="text-sm text-ink-muted">商談データの同期状況</p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-canvas rounded-lg p-3">
              <p className="text-xs text-ink-muted">最終同期日</p>
              <p className="text-sm font-medium text-ink mt-0.5">
                {lastSfSync ? new Date(lastSfSync).toLocaleString('ja-JP') : '未同期'}
              </p>
            </div>
            <div className="bg-canvas rounded-lg p-3">
              <p className="text-xs text-ink-muted">同期件数（商談+点検修繕）</p>
              <p className="text-sm font-medium text-ink mt-0.5">
                {sfRecordCount != null ? `${sfRecordCount} 件` : '—'}
              </p>
            </div>
          </div>

          <div className="p-3 bg-indigo-50 dark:bg-indigo-500/15 rounded-lg">
            <p className="text-xs text-indigo-700 dark:text-indigo-300 font-medium mb-1">同期方法</p>
            <p className="text-xs text-indigo-600 dark:text-indigo-300">
              30分ごとに自動同期され、画面には再読み込みなしで即時反映されます。すぐに同期したい場合は、下のGitHubトークンを設定すると案件一覧パネルの🔄ボタンから手動同期できます（約1分で反映）。
            </p>
          </div>

          {/* GitHub token for manual sync */}
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              GitHubトークン（手動同期用・任意）
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={githubToken}
                onChange={(e) => setGithubTokenInput(e.target.value)}
                placeholder="github_pat_..."
                className="flex-1 px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent font-mono text-ink"
              />
              <button
                onClick={handleSaveGithubToken}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                保存
              </button>
            </div>
            {githubTokenMsg && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">{githubTokenMsg}</p>
            )}
            <p className="text-xs text-ink-faint mt-1">
              この端末のみに保存されます。<strong>自分のGitHubアカウント</strong>で発行した Fine-grained PAT（OM_schedule リポジトリ / Actions: Read and write）を入力してください。トークンは個人の認証情報のため他の人と共有しないでください（リポジトリのコラボレーター権限が必要です。未設定でも30分ごとの自動同期は動作します）。空欄で保存すると削除されます。
            </p>
          </div>
        </div>
      </div>

      {/* ===== Section 4: Data Management ===== */}
      <div className="bg-raised rounded-xl border border-edge p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-100 dark:bg-amber-500/20 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-amber-600 dark:text-amber-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-ink">データ管理</h3>
            <p className="text-sm text-ink-muted">割り当てデータのエクスポート・インポート・リセット</p>
          </div>
        </div>

        <div className="space-y-3">
          {/* Current data info */}
          <div className="bg-canvas rounded-lg p-3">
            <p className="text-xs text-ink-muted">現在の割り当て件数</p>
            <p className="text-sm font-medium text-ink mt-0.5">{assignments.length} 件</p>
          </div>

          {/* Retention policy — keep users aware that old data is auto-pruned */}
          <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">データ保存期間: {ASSIGNMENT_RETENTION_DAYS}日（約半年）</p>
            <p className="text-xs text-amber-800/80 dark:text-amber-200/80 mt-1 leading-relaxed">
              {ASSIGNMENT_RETENTION_DAYS}日より前の割り当てデータは、共有データの容量上限を守るため自動的に削除されます。
              Outlookに登録した予定はOutlookカレンダーにそのまま残ります。
              過去の割り当てを記録として残したい場合は、下のJSONエクスポートをご利用ください。
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Export button */}
            <button
              onClick={handleExportJson}
              disabled={assignments.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink bg-canvas rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              JSONエクスポート
            </button>

            {/* Import button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-ink bg-canvas rounded-lg hover:bg-surface-hover transition-colors"
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
                  : 'text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25'
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
