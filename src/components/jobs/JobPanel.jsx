import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import JobCard, { STAGE_COLORS, MAINT_STATUS_COLORS } from './JobCard';
import { isFirestoreEnabled, saveFilterPresets, loadFilterPresets, subscribeFilterPresets } from '../../services/firestoreService';
import { getGithubToken, triggerSfSync } from '../../services/githubSyncService';
import { useSfData } from '../../context/SfDataContext';

/**
 * Sidebar panel listing Salesforce records.
 * Three tabs: レンタル商談 (opportunities), 自家消費 (self-consumption),
 * and 点検／修繕 (maintenance).
 * Data arrives asynchronously via SfDataContext (Firestore subscription).
 * Supports text search, stage/status filtering, collapsing,
 * and saving/loading filter presets via localStorage.
 */

// Tri-state filter chip: null (all) → true (confirmed only) → false (unconfirmed only) → null
function TriStateChip({ label, value, onChange }) {
  function cycle() {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  }

  let classes = 'bg-canvas text-ink-faint border-edge';
  let icon = '';
  if (value === true) {
    classes = 'bg-green-100 text-green-800 border-green-300 dark:bg-green-500/20 dark:text-green-300';
    icon = '✓ ';
  } else if (value === false) {
    classes = 'bg-red-100 text-red-800 border-red-300 dark:bg-red-500/20 dark:text-red-300';
    icon = '✗ ';
  }

  return (
    <button
      onClick={cycle}
      className={`text-xs px-2 py-0.5 rounded-full border transition font-medium ${classes}`}
      title={value === null ? '全て表示' : value ? '確定のみ' : '未確定のみ'}
    >
      {icon}{label}
    </button>
  );
}

const PRESETS_STORAGE_KEY = 'construction-schedule-filter-presets';
const LAST_FILTER_STORAGE_KEY = 'construction-schedule-last-filter';

function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY)) || [];
  } catch { return []; }
}

function savePresets(presets) {
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
}

function loadLastFilter() {
  try {
    return JSON.parse(localStorage.getItem(LAST_FILTER_STORAGE_KEY));
  } catch { return null; }
}

function saveLastFilter(filter) {
  localStorage.setItem(LAST_FILTER_STORAGE_KEY, JSON.stringify(filter));
}

export default function JobPanel({ onSelectOpportunity, isOpen = true, onToggle }) {
  const collapsed = !isOpen;

  // SF data streamed from Firestore (empty arrays until the first snapshot)
  const { opportunities, selfConsumption, maintenances, syncMeta, loading: sfLoading } = useSfData();

  const ALL_STAGES = useMemo(
    () => [...new Set(opportunities.map((o) => o.stage))].filter(Boolean).sort(),
    [opportunities]
  );
  const ALL_SELF_STAGES = useMemo(
    () => [...new Set(selfConsumption.map((o) => o.stage))].filter(Boolean).sort(),
    [selfConsumption]
  );
  const ALL_MAINT_STATUSES = useMemo(
    () => [...new Set(maintenances.map((m) => m.status))].filter(Boolean).sort(),
    [maintenances]
  );

  const TABS = [
    { id: 'opportunity', label: 'レンタル商談', count: opportunities.length },
    { id: 'self-consumption', label: '自家消費', count: selfConsumption.length },
    { id: 'maintenance', label: '点検／修繕', count: maintenances.length },
  ];

  // Manual SF sync (GitHub Actions workflow_dispatch)
  const [sfSyncing, setSfSyncing] = useState(false);
  const [sfSyncStatus, setSfSyncStatus] = useState('');

  async function handleSfSync() {
    if (sfSyncing) return;
    const token = getGithubToken();
    if (!token) {
      alert('手動同期にはGitHubトークンが必要です。\n設定画面の「Salesforce同期」セクションでトークンを登録してください。\n（登録しなくても30分ごとに自動同期されます）');
      return;
    }
    setSfSyncing(true);
    try {
      await triggerSfSync(token, setSfSyncStatus);
      // Fresh data arrives via the Firestore subscription — no reload needed
      alert('Salesforce同期が完了しました。最新データが反映されています。');
    } catch (err) {
      alert(`Salesforce同期エラー: ${err.message}`);
    } finally {
      setSfSyncing(false);
      setSfSyncStatus('');
    }
  }

  // Restore last filter from localStorage on initial render
  const lastFilter = useMemo(() => loadLastFilter(), []);

  const [activeTab, setActiveTab] = useState(lastFilter?.tab || 'opportunity');
  const [searchText, setSearchText] = useState('');
  const [activeStages, setActiveStages] = useState(() => {
    if (lastFilter?.tab === 'opportunity' && lastFilter?.filters) {
      return new Set(lastFilter.filters);
    }
    return new Set(ALL_STAGES);
  });
  const [activeSelfStages, setActiveSelfStages] = useState(() => {
    if (lastFilter?.tab === 'self-consumption' && lastFilter?.filters) {
      return new Set(lastFilter.filters);
    }
    return new Set(ALL_SELF_STAGES);
  });
  const [activeStatuses, setActiveStatuses] = useState(() => {
    if (lastFilter?.tab === 'maintenance' && lastFilter?.filters) {
      return new Set(lastFilter.filters);
    }
    return new Set(ALL_MAINT_STATUSES);
  });

  // Confirmation flag filters for opportunities
  const [surveyConfirmedFilter, setSurveyConfirmedFilter] = useState(null); // null=all, true=confirmed, false=unconfirmed
  const [constructionConfirmedFilter, setConstructionConfirmedFilter] = useState(null);

  const [presets, setPresets] = useState(loadPresets);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetName, setPresetName] = useState('');
  const fromFirestoreRef = useRef(false);

  // SF data loads asynchronously: once the first snapshot arrives, select all
  // stages/statuses for tabs that have no saved filter. Until then the
  // auto-save effect below must not run, or it would persist empty filters.
  const defaultsAppliedRef = useRef(false);
  useEffect(() => {
    if (sfLoading || defaultsAppliedRef.current) return;
    defaultsAppliedRef.current = true;
    if (!(lastFilter?.tab === 'opportunity' && lastFilter?.filters)) {
      setActiveStages(new Set(ALL_STAGES));
    }
    if (!(lastFilter?.tab === 'self-consumption' && lastFilter?.filters)) {
      setActiveSelfStages(new Set(ALL_SELF_STAGES));
    }
    if (!(lastFilter?.tab === 'maintenance' && lastFilter?.filters)) {
      setActiveStatuses(new Set(ALL_MAINT_STATUSES));
    }
  }, [sfLoading, ALL_STAGES, ALL_SELF_STAGES, ALL_MAINT_STATUSES, lastFilter]);

  // Load from Firestore on mount and subscribe to real-time updates
  useEffect(() => {
    if (!isFirestoreEnabled()) return;

    // Initial load from Firestore (overrides localStorage)
    loadFilterPresets().then((firestorePresets) => {
      if (firestorePresets) {
        fromFirestoreRef.current = true;
        setPresets(firestorePresets);
      }
    });

    // Subscribe to real-time updates
    const unsubscribe = subscribeFilterPresets((firestorePresets) => {
      fromFirestoreRef.current = true;
      setPresets(firestorePresets);
    });

    return unsubscribe;
  }, []);

  // Sync presets to localStorage and Firestore on change
  useEffect(() => {
    savePresets(presets);

    if (fromFirestoreRef.current) {
      fromFirestoreRef.current = false;
      return; // Don't save back to Firestore when update came from Firestore
    }
    saveFilterPresets(presets);
  }, [presets]);

  // Auto-save last used filter whenever tab or filters change
  // (skipped until SF data has loaded and defaults were applied)
  useEffect(() => {
    if (!defaultsAppliedRef.current) return;
    let filters;
    if (activeTab === 'opportunity') filters = [...activeStages];
    else if (activeTab === 'self-consumption') filters = [...activeSelfStages];
    else filters = [...activeStatuses];
    saveLastFilter({ tab: activeTab, filters });
  }, [activeTab, activeStages, activeSelfStages, activeStatuses]);

  function toggleFilter(set, setter, allItems, value) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleAll(set, setter, allItems) {
    if (set.size === allItems.length) setter(new Set());
    else setter(new Set(allItems));
  }

  const handleSavePreset = useCallback(() => {
    if (!presetName.trim()) return;
    let filters;
    if (activeTab === 'opportunity') filters = [...activeStages];
    else if (activeTab === 'self-consumption') filters = [...activeSelfStages];
    else filters = [...activeStatuses];
    const newPreset = {
      id: 'preset_' + Date.now(),
      name: presetName.trim(),
      tab: activeTab,
      filters,
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    setPresetName('');
    setShowPresetForm(false);
  }, [presetName, activeTab, activeStages, activeSelfStages, activeStatuses, presets]);

  const handleApplyPreset = useCallback((preset) => {
    setActiveTab(preset.tab);
    if (preset.tab === 'opportunity') {
      setActiveStages(new Set(preset.filters));
    } else if (preset.tab === 'self-consumption') {
      setActiveSelfStages(new Set(preset.filters));
    } else {
      setActiveStatuses(new Set(preset.filters));
    }
  }, []);

  const handleDeletePreset = useCallback((presetId) => {
    const updated = presets.filter((p) => p.id !== presetId);
    setPresets(updated);
  }, [presets]);

  // Filtered opportunities
  const filteredOpps = useMemo(() => {
    const q = searchText.toLowerCase();
    return opportunities.filter((opp) => {
      if (!activeStages.has(opp.stage)) return false;
      if (surveyConfirmedFilter !== null && !!opp.surveyConfirmed !== surveyConfirmedFilter) return false;
      if (constructionConfirmedFilter !== null && !!opp.constructionDateConfirmed !== constructionConfirmedFilter) return false;
      if (q) {
        const hay = `${opp.name} ${opp.accountName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [opportunities, searchText, activeStages, surveyConfirmedFilter, constructionConfirmedFilter]);

  // Filtered self-consumption opportunities
  const filteredSelf = useMemo(() => {
    const q = searchText.toLowerCase();
    return selfConsumption.filter((opp) => {
      if (!activeSelfStages.has(opp.stage)) return false;
      if (surveyConfirmedFilter !== null && !!opp.surveyConfirmed !== surveyConfirmedFilter) return false;
      if (constructionConfirmedFilter !== null && !!opp.constructionDateConfirmed !== constructionConfirmedFilter) return false;
      if (q) {
        const hay = `${opp.name} ${opp.accountName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [selfConsumption, searchText, activeSelfStages, surveyConfirmedFilter, constructionConfirmedFilter]);

  // Filtered maintenances
  const filteredMaints = useMemo(() => {
    const q = searchText.toLowerCase();
    return maintenances.filter((m) => {
      if (m.status && !activeStatuses.has(m.status)) return false;
      if (!m.status && !activeStatuses.has('(none)')) return false;
      if (q) {
        const hay = `${m.name} ${m.summary || ''} ${m.category || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [maintenances, searchText, activeStatuses]);

  const currentItems = activeTab === 'opportunity' ? filteredOpps
    : activeTab === 'self-consumption' ? filteredSelf
    : filteredMaints;

  const isOppTab = activeTab === 'opportunity' || activeTab === 'self-consumption';

  // Group items
  const grouped = useMemo(() => {
    const groups = {};
    for (const item of currentItems) {
      const key = isOppTab
        ? (item.stage || '不明')
        : (item.status || '未設定');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [currentItems, isOppTab]);

  // Collapsed state
  if (collapsed) {
    return (
      <div className="fixed right-0 top-14 z-30">
        <button
          onClick={() => onToggle()}
          className="bg-surface border border-edge rounded-l-lg px-2 py-3 shadow-md hover:bg-surface-hover transition"
          title="案件パネルを開く"
        >
          <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>
    );
  }

  const activeFilterSet = activeTab === 'opportunity' ? activeStages
    : activeTab === 'self-consumption' ? activeSelfStages
    : activeStatuses;
  const setActiveFilterSet = activeTab === 'opportunity' ? setActiveStages
    : activeTab === 'self-consumption' ? setActiveSelfStages
    : setActiveStatuses;
  const allFilterItems = activeTab === 'opportunity' ? ALL_STAGES
    : activeTab === 'self-consumption' ? ALL_SELF_STAGES
    : ALL_MAINT_STATUSES;
  const colorMap = isOppTab ? STAGE_COLORS : MAINT_STATUS_COLORS;

  return (
    <aside className="fixed right-0 top-14 bottom-0 w-80 bg-surface border-l border-edge shadow-lg z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-edge bg-canvas">
        <h2 className="text-sm font-bold text-ink">
          案件一覧
          <span className="ml-2 text-xs font-normal text-ink-muted">
            ({currentItems.length}件)
          </span>
          {syncMeta?.syncedAt && (
            <span className="block text-[10px] font-normal text-ink-faint mt-0.5" title={`SF最終同期: ${new Date(syncMeta.syncedAt).toLocaleString('ja-JP')}`}>
              SF同期: {new Date(syncMeta.syncedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-1">
          {/* Manual SF sync (requires GitHub token configured in 設定) */}
          <button
            onClick={handleSfSync}
            disabled={sfSyncing}
            className={`p-1 rounded transition ${
              sfSyncing ? 'text-accent cursor-wait' : 'hover:bg-surface-hover text-ink-muted'
            }`}
            title={sfSyncStatus || 'Salesforceから最新データを取得（要GitHubトークン設定）'}
          >
            <svg className={`w-4 h-4 ${sfSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => onToggle()}
            className="p-1 rounded hover:bg-surface-hover transition"
            title="パネルを閉じる"
          >
            <svg className="w-4 h-4 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* SF sync progress banner */}
      {sfSyncing && sfSyncStatus && (
        <div className="px-4 py-1.5 text-[11px] text-accent bg-accent-soft border-b border-edge flex items-center gap-1.5">
          <svg className="w-3 h-3 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {sfSyncStatus}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-edge">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchText(''); }}
            className={`flex-1 px-3 py-2 text-xs font-medium transition border-b-2 ${
              activeTab === tab.id
                ? 'border-orange-500 text-orange-700 bg-orange-50 dark:bg-orange-500/15 dark:text-orange-300'
                : 'border-transparent text-ink-muted hover:text-ink hover:bg-surface-hover'
            }`}
          >
            {tab.label}
            <span className="ml-1 text-ink-faint">({tab.count})</span>
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="px-3 pt-3">
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={isOppTab ? '案件名・取引先で検索...' : '点検名・概要・種別で検索...'}
          className="w-full px-3 py-2 text-sm border border-edge rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
        />
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 border-b border-grid">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={() => toggleAll(activeFilterSet, setActiveFilterSet, allFilterItems)}
            className="text-xs text-accent hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            {activeFilterSet.size === allFilterItems.length ? '全解除' : '全選択'}
          </button>
          <span className="text-ink-faint">|</span>
          <button
            onClick={() => setShowPresetForm((v) => !v)}
            className="text-xs text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 font-medium"
          >
            保存
          </button>
        </div>

        {/* Inline preset save form */}
        {showPresetForm && (
          <div className="flex items-center gap-1 mb-1.5">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSavePreset(); if (e.key === 'Escape') setShowPresetForm(false); }}
              placeholder="プリセット名を入力..."
              className="flex-1 text-xs px-2 py-1 border border-edge rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
              autoFocus
            />
            <button
              onClick={handleSavePreset}
              disabled={!presetName.trim()}
              className="text-xs px-2 py-1 bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              保存
            </button>
            <button
              onClick={() => { setShowPresetForm(false); setPresetName(''); }}
              className="text-xs px-1.5 py-1 text-ink-faint hover:text-ink-muted"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {allFilterItems.map((item) => {
            const isActive = activeFilterSet.has(item);
            let chipClasses = 'bg-canvas text-ink-faint border-edge';
            if (isActive) {
              if (isOppTab) {
                const prefix = item.substring(0, 2);
                const c = colorMap[prefix] || {};
                chipClasses = `${c.bg || 'bg-canvas'} ${c.text || 'text-ink'} ${c.border || 'border-edge'}`;
              } else {
                const c = colorMap[item] || {};
                chipClasses = `${c.bg || 'bg-canvas'} ${c.text || 'text-ink'} ${c.border || 'border-edge'}`;
              }
            }
            return (
              <button
                key={item}
                onClick={() => toggleFilter(activeFilterSet, setActiveFilterSet, allFilterItems, item)}
                className={`text-xs px-2 py-0.5 rounded-full border transition font-medium ${chipClasses}`}
              >
                {isOppTab ? item.substring(0, 2) : item}
              </button>
            );
          })}
        </div>

        {/* Confirmation flag filters (opportunities only) */}
        {isOppTab && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-grid">
            <TriStateChip
              label="本現調確定"
              value={surveyConfirmedFilter}
              onChange={setSurveyConfirmedFilter}
            />
            <TriStateChip
              label="着工日確定"
              value={constructionConfirmedFilter}
              onChange={setConstructionConfirmedFilter}
            />
          </div>
        )}
      </div>

      {/* Saved filter presets */}
      {presets.length > 0 && (
        <div className="px-3 py-2 border-b border-grid">
          <div className="text-xs text-ink-faint mb-1 flex items-center gap-1">
            <span>📌</span>
            <span>保存済みフィルター</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                className="group inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border border-dashed border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25 transition font-medium"
                title={`${preset.tab === 'opportunity' ? 'レンタル商談' : preset.tab === 'self-consumption' ? '自家消費' : '点検／修繕'}: ${preset.filters.length}件のフィルター`}
              >
                <span>{preset.name}</span>
                <span
                  onClick={(e) => { e.stopPropagation(); handleDeletePreset(preset.id); }}
                  className="ml-0.5 text-amber-400 hover:text-red-500 cursor-pointer"
                >
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {sfLoading ? (
          <p className="text-sm text-ink-faint text-center py-8 flex items-center justify-center gap-2">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            データ読み込み中...
          </p>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-ink-faint text-center py-8">
            該当する案件がありません
          </p>
        ) : (
          grouped.map(([groupKey, items]) => (
            <div key={groupKey}>
              <h3 className="text-xs font-bold text-ink-muted uppercase tracking-wide mb-2 sticky top-0 bg-surface py-1">
                {groupKey}
                <span className="ml-1 text-ink-faint font-normal">({items.length})</span>
              </h3>
              <div className="space-y-2">
                {items.map((item) => (
                  <JobCard
                    key={item.id}
                    opportunity={item}
                    onSelect={onSelectOpportunity}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
