import { useState, useMemo } from 'react';
import opportunities from '../../data/opportunities.json';
import maintenances from '../../data/maintenances.json';
import JobCard, { STAGE_COLORS, MAINT_STATUS_COLORS } from './JobCard';

/**
 * Sidebar panel listing Salesforce records.
 * Two tabs: レンタル商談 (opportunities) and 点検／修繕 (maintenance).
 * Supports text search, stage/status filtering, and collapsing.
 */

const ALL_STAGES = [...new Set(opportunities.map((o) => o.stage))].filter(Boolean).sort();
const ALL_MAINT_STATUSES = [...new Set(maintenances.map((m) => m.status))].filter(Boolean).sort();

const TABS = [
  { id: 'opportunity', label: 'レンタル商談', count: opportunities.length },
  { id: 'maintenance', label: '点検／修繕', count: maintenances.length },
];

export default function JobPanel({ onSelectOpportunity, isOpen = true, onToggle }) {
  const collapsed = !isOpen;
  const [activeTab, setActiveTab] = useState('opportunity');
  const [searchText, setSearchText] = useState('');
  const [activeStages, setActiveStages] = useState(new Set(ALL_STAGES));
  const [activeStatuses, setActiveStatuses] = useState(new Set(ALL_MAINT_STATUSES));

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

  // Filtered opportunities
  const filteredOpps = useMemo(() => {
    const q = searchText.toLowerCase();
    return opportunities.filter((opp) => {
      if (!activeStages.has(opp.stage)) return false;
      if (q) {
        const hay = `${opp.name} ${opp.accountName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [searchText, activeStages]);

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

  const currentItems = activeTab === 'opportunity' ? filteredOpps : filteredMaints;

  // Group items
  const grouped = useMemo(() => {
    const groups = {};
    for (const item of currentItems) {
      const key = activeTab === 'opportunity'
        ? (item.stage || '不明')
        : (item.status || '未設定');
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [currentItems, activeTab]);

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

  const activeFilterSet = activeTab === 'opportunity' ? activeStages : activeStatuses;
  const allFilterItems = activeTab === 'opportunity' ? ALL_STAGES : ALL_MAINT_STATUSES;
  const colorMap = activeTab === 'opportunity' ? STAGE_COLORS : MAINT_STATUS_COLORS;

  return (
    <aside className="fixed right-0 top-14 bottom-0 w-80 bg-white border-l border-gray-200 shadow-lg z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h2 className="text-sm font-bold text-gray-800">
          案件一覧
          <span className="ml-2 text-xs font-normal text-gray-500">
            ({currentItems.length}件)
          </span>
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
          placeholder={activeTab === 'opportunity' ? '案件名・取引先で検索...' : '点検名・概要・種別で検索...'}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
        />
      </div>

      {/* Filter chips */}
      <div className="px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-1 mb-1">
          <button
            onClick={() => toggleAll(activeFilterSet, activeTab === 'opportunity' ? setActiveStages : setActiveStatuses, allFilterItems)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {activeFilterSet.size === allFilterItems.length ? '全解除' : '全選択'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
          {allFilterItems.map((item) => {
            const isActive = activeFilterSet.has(item);
            let chipClasses = 'bg-gray-50 text-gray-400 border-gray-200';
            if (isActive) {
              if (activeTab === 'opportunity') {
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
                onClick={() => toggleFilter(activeFilterSet, activeTab === 'opportunity' ? setActiveStages : setActiveStatuses, allFilterItems, item)}
                className={`text-xs px-2 py-0.5 rounded-full border transition font-medium ${chipClasses}`}
              >
                {activeTab === 'opportunity' ? item.substring(0, 2) : item}
              </button>
            );
          })}
        </div>
      </div>

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
