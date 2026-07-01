import { useState, useEffect } from 'react';
import { MEMBERS } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { createEventForMember } from '../../services/graphCalendarService';
import { buildEventBody } from '../../services/eventBodyTemplate';
import { useModalDrag } from '../../hooks/useModalDrag';
import { addDays } from '../../utils/dateUtils';

/**
 * Quick-add modal for creating a manual schedule entry via double-click.
 * Simpler than AssignModal — no Salesforce opportunity required.
 */

const TIME_SLOTS = [];
for (let h = 0; h <= 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 24 && m > 0) break;
    TIME_SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

export default function QuickAddModal({ isOpen, onClose, presetDate, presetTime, presetMemberId, presetAllDay, presetIsDelivery }) {
  const { dispatch } = useApp();
  const { isAuthenticated, getToken } = useAuth();
  const { dragOffset, handleDragHandleMouseDown, resetDrag } = useModalDrag();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [isAllDay, setIsAllDay] = useState(false);
  const [isDelivery, setIsDelivery] = useState(false);
  const [location, setLocation] = useState('');
  const [memo, setMemo] = useState('');
  const [syncOutlook, setSyncOutlook] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDate(presetDate || '');
      setStartTime(presetTime || '09:00');
      // Default 1 hour duration
      const startH = parseInt(presetTime?.substring(0, 2) || '9');
      setEndTime(`${String(Math.min(startH + 1, 24)).padStart(2, '0')}:00`);
      setSelectedMembers(presetMemberId ? [presetMemberId] : []);
      setIsAllDay(presetAllDay || false);
      setIsDelivery(presetIsDelivery || false);
      setLocation('');
      setMemo('');
      setSyncOutlook(true);
      setSaving(false);
      resetDrag();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, presetDate, presetTime, presetMemberId, presetAllDay, presetIsDelivery]);

  if (!isOpen) return null;

  function toggleMember(id) {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) { alert('件名を入力してください。'); return; }
    if (!date) { alert('日付を入力してください。'); return; }
    if (selectedMembers.length === 0) { alert('担当者を1名以上選択してください。'); return; }

    setSaving(true);

    const finalTitle = isDelivery ? `【納品】${title.trim()}` : title.trim();
    const effStart = isDelivery ? '08:00' : (isAllDay ? '00:00' : startTime);
    const effEnd = isDelivery ? '17:00' : (isAllDay ? '24:00' : endTime);
    const effAllDay = isDelivery ? false : isAllDay;

    const groupId = selectedMembers.length > 1
      ? `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
      : null;

    const outlookErrors = [];

    for (const memberId of selectedMembers) {
      const member = MEMBERS.find((m) => m.id === memberId);

      // Create Outlook event FIRST to capture returned ID
      let outlookEventId = null;
      if (syncOutlook && isAuthenticated && member && !member.skipOutlookSync) {
        try {
          const token = await getToken();
          if (token) {
            const bodyContent = buildEventBody(memo);
            const eventData = effAllDay ? {
              subject: finalTitle,
              isAllDay: true,
              // Graph requires all-day events to span >= 24h: end = next-day midnight
              start: { dateTime: `${date}T00:00:00`, timeZone: 'Asia/Tokyo' },
              end: { dateTime: `${addDays(date)}T00:00:00`, timeZone: 'Asia/Tokyo' },
              location: { displayName: location },
              body: { contentType: 'Text', content: bodyContent },
            } : {
              subject: finalTitle,
              start: { dateTime: `${date}T${effStart}:00`, timeZone: 'Asia/Tokyo' },
              end: { dateTime: `${date}T${effEnd}:00`, timeZone: 'Asia/Tokyo' },
              location: { displayName: location },
              body: { contentType: 'Text', content: bodyContent },
            };
            const result = await createEventForMember(token, member, eventData);
            if (result.success) outlookEventId = result.data?.id || null;
            else outlookErrors.push(`${member.nameJa}: ${result.error}`);
          }
        } catch (err) {
          outlookErrors.push(`${member?.nameJa || memberId}: ${err.message}`);
        }
      }

      dispatch({
        type: 'ADD_ASSIGNMENT',
        payload: {
          sourceType: 'manual',
          opportunityId: null,
          opportunityName: finalTitle,
          memberId,
          memberEmail: member?.email || null,
          date,
          startTime: effStart,
          endTime: effEnd,
          isAllDay: effAllDay,
          isDelivery,
          syncOutlook,
          address: location,
          scheduleMemo: memo,
          outlookEventId,
          groupId,
        },
      });
    }

    setSaving(false);
    if (outlookErrors.length > 0) {
      alert(`予定を追加しました。\nOutlook同期エラー:\n${outlookErrors.join('\n')}`);
    }
    onClose();
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
            className="flex items-center justify-between px-5 py-3 border-b border-edge bg-orange-50 dark:bg-orange-500/10 rounded-t-xl cursor-move select-none"
            onMouseDown={handleDragHandleMouseDown}
            title="ドラッグで移動"
          >
            <h2 className="text-base font-bold text-ink">{isDelivery ? '納品予定を追加' : '予定を追加'}</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-hover">
              <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            {/* Title */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="件名（例: パワまる工事 ○○様）"
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              autoFocus
            />

            {/* Members (multi-select) */}
            <div>
              <label className="block text-xs text-ink-muted mb-1">
                担当者 <span className="text-red-500">*</span>
                {selectedMembers.length > 0 && (
                  <span className="ml-2 text-orange-600">({selectedMembers.length}名選択中)</span>
                )}
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {MEMBERS.map((m) => {
                  const isSelected = selectedMembers.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMember(m.id)}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm transition ${
                        isSelected
                          ? 'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 ring-1 ring-orange-500'
                          : 'border-edge bg-raised text-ink hover:bg-surface-hover'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                      {m.nameJa}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date */}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />

            {/* All-day toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded border-edge focus:ring-orange-500"
              />
              <span className="text-sm text-ink">終日</span>
            </label>

            {/* Time */}
            {!isAllDay && <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-ink-muted mb-1 block">開始</label>
                <select value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-muted mb-1 block">終了</label>
                <select value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                  {TIME_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>}

            {/* Location */}
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="場所（任意）"
              className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />

            {/* Outlook sync */}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={syncOutlook} onChange={(e) => setSyncOutlook(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded" />
              Outlookに登録する
            </label>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-sm text-ink-muted bg-canvas hover:bg-surface-hover rounded-lg">
                キャンセル
              </button>
              <button type="submit" disabled={saving}
                className={`px-5 py-2 text-sm text-white rounded-lg font-medium ${saving ? 'bg-orange-400' : 'bg-orange-600 hover:bg-orange-700'}`}>
                {saving ? '保存中...' : '追加'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
