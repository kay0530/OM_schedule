import { useState, useEffect } from 'react';
import { MEMBERS } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { createCalendarEvent } from '../../services/graphCalendarService';
import { buildEventBody } from '../../services/eventBodyTemplate';
import { useModalDrag } from '../../hooks/useModalDrag';

/**
 * Modal dialog for assigning a job (opportunity or maintenance) to member(s).
 * Supports multi-member selection, date/time inputs, and Outlook sync toggle.
 */

// Generate time slots at 30-min intervals from 00:00 to 24:00
const TIME_SLOTS = [];
for (let h = 0; h <= 24; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 24 && m > 0) break;
    TIME_SLOTS.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
}

export default function AssignModal({
  isOpen,
  onClose,
  opportunity,
  preselectedMember,
  preselectedDate,
  preselectedStartTime,
  preselectedEndTime,
}) {
  const { dispatch } = useApp();
  const { isAuthenticated, getToken } = useAuth();
  const { dragOffset, handleDragHandleMouseDown, resetDrag } = useModalDrag();

  const [selectedMembers, setSelectedMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [syncOutlook, setSyncOutlook] = useState(true);
  const [isAllDay, setIsAllDay] = useState(false);
  const [workCategory, setWorkCategory] = useState('');
  const [customCategory, setCustomCategory] = useState('');
  const [memo, setMemo] = useState('');

  // Reset form when opportunity changes or modal opens
  useEffect(() => {
    if (isOpen && opportunity) {
      setSelectedMembers(preselectedMember ? [preselectedMember] : []);
      // Use appropriate date field based on record type
      const defaultDate = opportunity.type === 'maintenance'
        ? opportunity.scheduledDate
        : opportunity.constructionDate;
      setDate(preselectedDate || defaultDate || '');
      setStartTime(preselectedStartTime || '08:00');
      setEndTime(preselectedEndTime || '17:00');
      setSyncOutlook(true);
      setIsAllDay(false);
      setWorkCategory('');
      setCustomCategory('');
      // Pre-fill memo from SF source (maintenance content or opportunity memo)
      const isMaint = opportunity.type === 'maintenance';
      setMemo(isMaint ? (opportunity.content || '') : (opportunity.scheduleMemo || ''));
      resetDrag();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, opportunity, preselectedMember, preselectedDate, preselectedStartTime, preselectedEndTime]);

  if (!isOpen || !opportunity) return null;

  function toggleMember(memberId) {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (selectedMembers.length === 0) {
      alert('担当者を1名以上選択してください。');
      return;
    }
    if (!date) {
      alert('日付を入力してください。');
      return;
    }

    setSaving(true);

    // Build title with work category prefix
    const categoryLabel = workCategory === 'その他（手入力）' ? customCategory.trim() : workCategory;
    const displayName = categoryLabel
      ? `【${categoryLabel}】${opportunity.name}`
      : opportunity.name;

    // Build payload based on record type
    const isMaint = opportunity.type === 'maintenance';
    const outlookResults = [];

    // Group ID shared across all members for this assignment batch
    const groupId = selectedMembers.length > 1
      ? `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
      : null;

    for (const memberId of selectedMembers) {
      const member = MEMBERS.find((m) => m.id === memberId);

      // Create Outlook event FIRST so we can store the returned ID on the assignment
      let outlookEventId = null;
      if (syncOutlook && member && !member.skipOutlookSync) {
        if (!isAuthenticated) {
          outlookResults.push({ member: member.nameJa, success: false, error: 'MS365未ログイン' });
        } else {
          try {
            const token = await getToken();
            if (!token) {
              outlookResults.push({ member: member.nameJa, success: false, error: 'トークン取得失敗' });
            } else {
              const bodyContent = buildEventBody(memo || opportunity.scheduleMemo || opportunity.content || '');
              const eventData = isAllDay ? {
                subject: displayName,
                isAllDay: true,
                start: { dateTime: `${date}T00:00:00`, timeZone: 'Asia/Tokyo' },
                end: { dateTime: `${date}T00:00:00`, timeZone: 'Asia/Tokyo' },
                location: { displayName: opportunity.address || '' },
                body: { contentType: 'Text', content: bodyContent },
              } : {
                subject: displayName,
                start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Tokyo' },
                end: { dateTime: `${date}T${endTime}:00`, timeZone: 'Asia/Tokyo' },
                location: { displayName: opportunity.address || '' },
                body: { contentType: 'Text', content: bodyContent },
              };
              const result = await createCalendarEvent(token, member.email, eventData);
              if (result.success) outlookEventId = result.data?.id || null;
              outlookResults.push({ member: member.nameJa, success: result.success, error: result.error });
            }
          } catch (err) {
            outlookResults.push({ member: member.nameJa, success: false, error: err.message });
          }
        }
      }

      const assignmentPayload = {
        sourceType: opportunity.type || 'opportunity',
        opportunityId: opportunity.id,
        opportunityName: displayName,
        workCategory: categoryLabel || null,
        accountName: isMaint ? null : opportunity.accountName,
        summary: isMaint ? opportunity.summary : null,
        category: opportunity.category || null,
        status: isMaint ? opportunity.status : opportunity.stage,
        memberId,
        memberEmail: member?.email || null,
        date,
        startTime: isAllDay ? '00:00' : startTime,
        endTime: isAllDay ? '24:00' : endTime,
        isAllDay,
        syncOutlook,
        stage: isMaint ? null : opportunity.stage,
        address: opportunity.address,
        scheduleMemo: memo || (isMaint ? opportunity.content : opportunity.scheduleMemo),
        outlookEventId,
        groupId,
      };

      dispatch({ type: 'ADD_ASSIGNMENT', payload: assignmentPayload });
    }

    setSaving(false);

    // Show results
    if (outlookResults.length > 0) {
      const successes = outlookResults.filter((r) => r.success).length;
      const failures = outlookResults.filter((r) => !r.success);
      if (failures.length === 0) {
        alert(`割り当て完了。Outlook予定を${successes}件作成しました。`);
      } else {
        const failNames = failures.map((f) => `${f.member}: ${f.error}`).join('\n');
        alert(`割り当て完了。Outlook: ${successes}件成功、${failures.length}件失敗\n${failNames}`);
      }
    } else if (syncOutlook) {
      alert('割り当て完了。（Outlook登録対象のメンバーがいませんでした）');
    } else {
      alert('割り当て完了。');
    }

    onClose();
  }

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/40 dark:bg-black/60 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-raised text-ink rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        >
          {/* Header (drag to move) */}
          <div
            className="flex items-center justify-between px-6 py-4 border-b border-edge cursor-move select-none"
            onMouseDown={handleDragHandleMouseDown}
            title="ドラッグで移動"
          >
            <h2 className="text-lg font-bold text-ink">
              {opportunity.type === 'maintenance' ? '点検／修繕 割り当て' : '工事割り当て'}
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-surface-hover transition"
            >
              <svg className="w-5 h-5 text-ink-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-5">
            {/* Opportunity name (read-only) */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                案件名
              </label>
              <div className="px-3 py-2 bg-canvas rounded-lg border border-edge text-sm text-ink">
                {opportunity.name}
                {opportunity.type === 'maintenance' ? (
                  opportunity.summary && (
                    <span className="text-ink-muted ml-2">({opportunity.summary})</span>
                  )
                ) : (
                  opportunity.accountName && (
                    <span className="text-ink-muted ml-2">({opportunity.accountName})</span>
                  )
                )}
                {opportunity.type === 'maintenance' && opportunity.category && (
                  <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">
                    {opportunity.category}
                  </span>
                )}
              </div>
            </div>

            {/* Work category */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                作業種別
              </label>
              <div className="flex flex-wrap gap-2">
                {['現地調査', 'パワまる工事', '年次点検', '洗浄', '草刈り', '事前準備', 'その他（手入力）'].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setWorkCategory(workCategory === cat ? '' : cat)}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition ${
                      workCategory === cat
                        ? 'border-orange-500 bg-orange-50 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 ring-1 ring-orange-500'
                        : 'border-edge bg-raised text-ink hover:bg-surface-hover'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              {workCategory === 'その他（手入力）' && (
                <input
                  type="text"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="作業種別を入力..."
                  className="mt-2 w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  autoFocus
                />
              )}
            </div>

            {/* Member multi-select */}
            <div>
              <label className="block text-sm font-medium text-ink mb-2">
                担当者 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                {MEMBERS.map((member) => {
                  const isSelected = selectedMembers.includes(member.id);
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleMember(member.id)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 ring-1 ring-blue-500'
                          : 'border-edge bg-raised text-ink hover:bg-surface-hover'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: member.color }}
                      />
                      {member.nameJa}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                日付 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>

            {/* All-day toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                className="w-4 h-4 text-accent rounded border-edge focus:ring-accent"
              />
              <span className="text-sm text-ink">終日</span>
            </label>

            {/* Time range */}
            {!isAllDay && <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  開始時間
                </label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1">
                  終了時間
                </label>
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>}

            {/* Memo */}
            <div>
              <label className="block text-sm font-medium text-ink mb-1">
                メモ
              </label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                rows={3}
                placeholder="メモ（任意）"
                className="w-full px-3 py-2 border border-edge rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
              />
            </div>

            {/* Outlook sync checkbox */}
            <div className="flex items-center gap-3">
              <input
                id="sync-outlook"
                type="checkbox"
                checked={syncOutlook}
                onChange={(e) => setSyncOutlook(e.target.checked)}
                className="w-4 h-4 text-accent border-edge rounded focus:ring-accent"
              />
              <label htmlFor="sync-outlook" className="text-sm text-ink">
                Outlookに登録する
              </label>
            </div>
            {syncOutlook && (
              <p className="text-xs text-ink-faint -mt-3 ml-7">
                保存後、Outlook予定表にイベントが作成されます。
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-grid">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-ink-muted bg-canvas hover:bg-surface-hover rounded-lg transition"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`px-5 py-2 text-sm text-white rounded-lg transition font-medium ${
                  saving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {saving ? '保存中...' : '割り当てる'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
