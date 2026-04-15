import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import opportunities from '../../data/opportunities.json';
import selfConsumption from '../../data/self-consumption.json';
import maintenances from '../../data/maintenances.json';
import syncMeta from '../../data/sync-meta.json';
import JobCard, { STAGE_COLORS, MAINT_STATUS_COLORS } from './JobCard';
import { isFirestoreEnabled, saveFilterPresets, loadFilterPresets, subscribeFilterPresets } from '../../services/firestoreService';

/**
 * Sidebar panel listing Salesforce records.
 * Three tabs: レンタル商談 (opportunities), 自家消費 (self-consumption),
 * and 点検／修繕 (maintenance).
 * Supports text search, stage/status filtering, collapsing,
 * and saving/loading filter presets via localStorage.
 */

const ALL_STAGES = [...new Set(opportunities.map((o) => o.stage))].filter(Boolean).sort();
const ALL_SELF_STAGES = [...new Set(selfConsumption.map((o) => o.stage))].filter(Boolean).sort();
const ALL_MAINT_STATUSES = [...new Set(maintenances.map((m) => m.status))].filter(Boolean).sort();

// Tri-state filter chip: null (all) → true (confirmed only) → false (unconfirmed only) → null
function TriStateChip({ label, value, onChange }) {
  function cycle() {
    if (value === null) onChange(true);
    else if (value === true) onChange(false);
    else onChange(null);
  }

  let classes = 'bg-gray-50 text-gray-400 border-gray-200';
  let icon = '';
  if (value === true) {
    classes = 'bg-green-100 text-green-800 border-green-300';
    icon = '✓ ';
  } else if (value === false) {
    classes = 'bg-red-100 text-red-800 border-red-300';
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

const TABS = [
  { id: 'opportunity', label: 'レンタル商談', count: opportunities.length },
  { id: 'self-consumption', label: '自家消費', count: selfConsumption.length },
  { id: 'maintenance', label: '点検／修繕', count: maintenances.length },
];

export default function JobPanel({ onSelectOpportunity, isOpen = true, onToggle }) {
  const collapsed = !isOpen;

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
  useEffect(() => {
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
  }, [searchText, activeStages, surveyConfirmedFilter, constructionConfirmedFilter]);

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
  }, [searchText, activeSelfStages, surveyConfirmedFilter, constructionConfirmedFilter]);

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
  }, [searchText, activeStatuses]);

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
          className="bg-white border border-gray-300 rounded-l-lg px-2 py-3 shadow-md hover:bg-gray-50 transition"
          title="案件パネルを開く"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
    <aside className="fixed right-0 top-14 bottom-0 w-80 bg-white border-l border-gray-200 shadow-lg z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-sm font-bold text-gray-800">
          案件一覧
          <span className="ml-2 text-xs font-normal text-gray-500">
            ({currentItems.length}件)
          </span>
          {syncMeta?.syncedAt && (
            <span className="block text-[10px] font-normal text-gray-400 mt-0.5" title={`SF最終同期: ${new Date(syncMeta.syncedAt).toLocaleString('ja-JP')}`}>
              SF同期: {new Date(syncMeta.syncedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </h2>
        <button
          onClick={() => onToggle()}
          className="p-1 rounded hover:bg-gray-200 transition"
          title="パネルを閉じる"
        >
          <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSearchText(''); }}
            className={`flex-1 px-3 py-2 text-xs font-medium transition border-b-2 ${
              activeTab === tab.id
                ? 'border-orange-500 text-orange-700 bg-orange-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            <span className="ml-1 text-gray-400">({tab.count})</span>
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
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
        />
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-1">
          <button
            onClick={() => toggleAll(activeFilterSet, setActiveFilterSet, allFilterItems)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {activeFilterSet.size === allFilterItems.length ? '全解除' : '全選択'}
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={() => setShowPresetForm((v) => !v)}
            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
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
              className="flex-1 text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-emerald-400"
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
              className="text-xs px-1.5 py-1 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {allFilterItems.map((item) => {
            const isActive = activeFilterSet.has(item);
            let chipClasses = 'bg-gray-50 text-gray-400 border-gray-200';
            if (isActive) {
              if (isOppTab) {
                const prefix = item.substring(0, 2);
                const c = colorMap[prefix] || {};
                chipClasses = `${c.bg || 'bg-gray-100'} ${c.text || 'text-gray-700'} ${c.border || 'border-gray-300'}`;
              } else {
                const c = colorMap[item] || {};
                chipClasses = `${c.bg || 'bg-gray-100'} ${c.text || 'text-gray-700'} ${c.border || 'border-gray-300'}`;
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
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100">
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
        <div className="px-3 py-2 border-b border-gray-100">
          <div className="text-xs text-gray-400 mb-1 flex items-center gap-1">
            <span>📌</span>
            <span>保存済みフィルター</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                className="group inline-flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full border border-dashed border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 transition font-medium"
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
        {grouped.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">
            該当する案件がありません
          </p>
        ) : (
          grouped.map(([groupKey, items]) => (
            <div key={groupKey}>
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 sticky top-0 bg-white py-1">
                {groupKey}
                <span className="ml-1 text-gray-400 font-normal">({items.length})</span>
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
