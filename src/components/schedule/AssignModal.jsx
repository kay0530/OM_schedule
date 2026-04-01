import { useState, useEffect } from 'react';
import { MEMBERS } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { createCalendarEvent } from '../../services/graphCalendarService';

/**
 * Modal dialog for assigning a job (opportunity or maintenance) to member(s).
 * Supports multi-member selection, date/time inputs, and Outlook sync toggle.
 */

// Generate time slots at 30-min intervals from 08:00 to 18:00
const TIME_SLOTS = [];
for (let h = 8; h <= 18; h++) {
  for (let m = 0; m < 60; m += 30) {
    if (h === 18 && m > 0) break;
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

  const [selectedMembers, setSelectedMembers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('17:00');
  const [syncOutlook, setSyncOutlook] = useState(true);

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
    }
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

    // Build payload based on record type
    const isMaint = opportunity.type === 'maintenance';
    const outlookResults = [];

    for (const memberId of selectedMembers) {
      const member = MEMBERS.find((m) => m.id === memberId);
      const assignmentPayload = {
        sourceType: opportunity.type || 'opportunity',
        opportunityId: opportunity.id,
        opportunityName: opportunity.name,
        accountName: isMaint ? null : opportunity.accountName,
        summary: isMaint ? opportunity.summary : null,
        category: opportunity.category || null,
        status: isMaint ? opportunity.status : opportunity.stage,
        memberId,
        date,
        startTime,
        endTime,
        syncOutlook,
        stage: isMaint ? null : opportunity.stage,
        address: opportunity.address,
        scheduleMemo: isMaint ? opportunity.content : opportunity.scheduleMemo,
      };

      dispatch({ type: 'ADD_ASSIGNMENT', payload: assignmentPayload });

      // Collect members for Outlook event (handled after loop)
    }

    // Create Outlook event on logged-in user's calendar with selected members as attendees
    if (syncOutlook && selectedMembers.length > 0) {
      if (!isAuthenticated) {
        outlookResults.push({ member: '自分', success: false, error: 'MS365未ログイン。右上の「MS365 連携」からログインしてください。' });
      } else {
        try {
          const token = await getToken();
          if (!token) {
            outlookResults.push({ member: '自分', success: false, error: 'トークン取得失敗。再ログインしてください。' });
          } else {
            // Build attendees list from selected members
            const attendees = selectedMembers
              .map((mid) => MEMBERS.find((m) => m.id === mid))
              .filter((m) => m && !m.skipOutlookSync)
              .map((m) => ({
                emailAddress: { address: m.email, name: m.nameJa },
                type: 'required',
              }));

            const eventData = {
              subject: opportunity.name,
              start: {
                dateTime: `${date}T${startTime}:00`,
                timeZone: 'Asia/Tokyo',
              },
              end: {
                dateTime: `${date}T${endTime}:00`,
                timeZone: 'Asia/Tokyo',
              },
              location: {
                displayName: opportunity.address || '',
              },
              body: {
                contentType: 'Text',
                content: opportunity.scheduleMemo || opportunity.content || '',
              },
              attendees: attendees.length > 0 ? attendees : undefined,
            };

            // Create on logged-in user's own calendar (using /me/events)
            const response = await fetch('https://graph.microsoft.com/v1.0/me/events', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(eventData),
            });

            if (response.ok) {
              const memberNames = attendees.map((a) => a.emailAddress.name).join(', ');
              outlookResults.push({
                member: '自分',
                success: true,
                error: null,
                detail: memberNames ? `出席者: ${memberNames}` : null,
              });
            } else {
              const errBody = await response.json().catch(() => ({}));
              outlookResults.push({
                member: '自分',
                success: false,
                error: errBody.error?.message || `HTTP ${response.status}`,
              });
            }
          }
        } catch (err) {
          outlookResults.push({ member: '自分', success: false, error: err.message });
        }
      }
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
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-800">
              {opportunity.type === 'maintenance' ? '点検／修繕 割り当て' : '工事割り当て'}
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-gray-100 transition"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-5">
            {/* Opportunity name (read-only) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                案件名
              </label>
              <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm text-gray-800">
                {opportunity.name}
                {opportunity.type === 'maintenance' ? (
                  opportunity.summary && (
                    <span className="text-gray-500 ml-2">({opportunity.summary})</span>
                  )
                ) : (
                  opportunity.accountName && (
                    <span className="text-gray-500 ml-2">({opportunity.accountName})</span>
                  )
                )}
                {opportunity.type === 'maintenance' && opportunity.category && (
                  <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                    {opportunity.category}
                  </span>
                )}
              </div>
            </div>

            {/* Member multi-select */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
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
                          ? 'border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-500'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                日付 <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            {/* Time range */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  開始時間
                </label>
                <select
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  終了時間
                </label>
                <select
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {TIME_SLOTS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Outlook sync checkbox */}
            <div className="flex items-center gap-3">
              <input
                id="sync-outlook"
                type="checkbox"
                checked={syncOutlook}
                onChange={(e) => setSyncOutlook(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="sync-outlook" className="text-sm text-gray-700">
                Outlookに登録する
              </label>
            </div>
            {syncOutlook && (
              <p className="text-xs text-gray-400 -mt-3 ml-7">
                保存後、Outlook予定表にイベントが作成されます。
              </p>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
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
