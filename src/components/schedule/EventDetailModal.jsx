import { useState, useEffect, useRef } from 'react';
import { MEMBERS } from '../../data/members';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { useCalendar } from '../../context/CalendarContext';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../../services/graphCalendarService';
import { buildEventBody } from '../../services/eventBodyTemplate';

// Generate 30-minute interval options from 08:00 to 18:00
const TIME_OPTIONS = [];
for (let h = 8; h <= 18; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:00`);
  if (h < 18) TIME_OPTIONS.push(`${String(h).padStart(2, '0')}:30`);
}

/**
 * Modal that displays event details and allows editing/deleting.
 *
 * @param {{ isOpen: boolean, onClose: () => void, event: object|null }}
 */
export default function EventDetailModal({ isOpen, onClose, event }) {
  const { assignments, dispatch } = useApp();
  const { isAuthenticated, getToken } = useAuth();
  const { events, setEvents } = useCalendar();

  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState(null);

  // Editable fields
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editStartTime, setEditStartTime] = useState('08:00');
  const [editEndTime, setEditEndTime] = useState('09:00');
  const [editMemberIds, setEditMemberIds] = useState([]);
  const [editLocation, setEditLocation] = useState('');
  const [editMemo, setEditMemo] = useState('');
  const [syncToOutlook, setSyncToOutlook] = useState(false);

  // Modal drag state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef(null);

  function handleHeaderMouseDown(e) {
    if (e.button !== 0) return;
    // Don't initiate drag if clicking interactive elements
    if (e.target.closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: dragOffset.x,
      origY: dragOffset.y,
    };
    function onMove(ev) {
      const s = dragStartRef.current;
      if (!s) return;
      setDragOffset({ x: s.origX + (ev.clientX - s.startX), y: s.origY + (ev.clientY - s.startY) });
    }
    function onUp() {
      dragStartRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Reset state when event changes or modal opens
  useEffect(() => {
    if (event && isOpen) {
      setEditMode(false);
      setDeleteConfirm(false);
      setError(null);
      setSaving(false);

      const startTime = event.startTime || event.start?.substring(11, 16) || '08:00';
      const endTime = event.endTime || event.end?.substring(11, 16) || '09:00';
      const eventDate = event.date || event.start?.substring(0, 10) || '';

      setEditTitle(event.opportunityName || event.title || '');
      setEditDate(eventDate);
      setEditStartTime(startTime);
      setEditEndTime(endTime);
      // Pre-select all group members (or just self for non-group events)
      const groupMemberIds = event.groupId
        ? assignments.filter((a) => a.groupId === event.groupId).map((a) => a.memberId)
        : (event.memberId ? [event.memberId] : []);
      setEditMemberIds([...new Set(groupMemberIds)]);
      setEditLocation(event.address || event.location || '');
      setEditMemo(event.scheduleMemo || '');
      setSyncToOutlook(false);
      setDragOffset({ x: 0, y: 0 });
    }
  }, [event, isOpen, assignments]);

  if (!isOpen || !event) return null;

  // Determine event source
  const isAssignment = !!event.opportunityName;
  const isManualAssignment = isAssignment && !event.isOutlookSynced;

  function isOutlookEvent(ev) {
    return !!ev.outlookEventId || (!ev.opportunityName && !ev.statusType && !!ev.memberEmail);
  }
  const isOutlook = isOutlookEvent(event);

  // Find member info
  const member = MEMBERS.find(
    (m) => m.id === event.memberId || m.email === event.memberEmail
  );

  // Display values (read-only mode)
  const startTime = event.startTime || event.start?.substring(11, 16);
  const endTime = event.endTime || event.end?.substring(11, 16);
  const eventDate = event.date || event.start?.substring(0, 10);

  // Source label
  let sourceLabel, sourceBadgeClass;
  if (isOutlook && !isAssignment) {
    sourceLabel = 'Outlook';
    sourceBadgeClass = 'bg-blue-50 text-blue-700';
  } else if (isAssignment) {
    sourceLabel = '手動割当';
    sourceBadgeClass = 'bg-emerald-50 text-emerald-700';
  } else {
    sourceLabel = 'ステータス';
    sourceBadgeClass = 'bg-gray-100 text-gray-600';
  }

  function handleEnterEditMode() {
    setEditMode(true);
    setError(null);
    setDeleteConfirm(false);
  }

  function handleCancelEdit() {
    setEditMode(false);
    setError(null);
    // Reset fields
    const st = event.startTime || event.start?.substring(11, 16) || '08:00';
    const et = event.endTime || event.end?.substring(11, 16) || '09:00';
    const ed = event.date || event.start?.substring(0, 10) || '';
    setEditTitle(event.opportunityName || event.title || '');
    setEditDate(ed);
    setEditStartTime(st);
    setEditEndTime(et);
    const groupMemberIds = event.groupId
      ? assignments.filter((a) => a.groupId === event.groupId).map((a) => a.memberId)
      : (event.memberId ? [event.memberId] : []);
    setEditMemberIds([...new Set(groupMemberIds)]);
    setEditLocation(event.address || event.location || '');
    setEditMemo(event.scheduleMemo || '');
  }

  function toggleEditMember(id) {
    setEditMemberIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  // Current group members (all assignments sharing groupId, OR just self if no group)
  const groupAssignments = event?.groupId
    ? assignments.filter((a) => a.groupId === event.groupId)
    : (isManualAssignment ? [event] : []);

  async function handleSave() {
    if (!editTitle.trim()) {
      setError('タイトルを入力してください');
      return;
    }
    if (!editDate) {
      setError('日付を選択してください');
      return;
    }
    if (editStartTime >= editEndTime) {
      setError('終了時間は開始時間より後にしてください');
      return;
    }

    if (editMemberIds.length === 0) {
      setError('担当者を1名以上選択してください');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const sharedUpdates = {
        opportunityName: editTitle,
        title: editTitle,
        date: editDate,
        startTime: editStartTime,
        endTime: editEndTime,
        address: editLocation,
        scheduleMemo: editMemo,
      };

      const outlookErrors = [];
      const token = (syncToOutlook && isAuthenticated) ? await getToken() : null;

      if (isManualAssignment) {
        // Diff: which members stay, get added, get removed
        const currentMemberIds = new Set(groupAssignments.map((a) => a.memberId));
        const newMemberIds = new Set(editMemberIds);

        const stayingAssignments = groupAssignments.filter((a) => newMemberIds.has(a.memberId));
        const removedAssignments = groupAssignments.filter((a) => !newMemberIds.has(a.memberId));
        const addedMemberIds = editMemberIds.filter((id) => !currentMemberIds.has(id));

        // Ensure groupId exists if we'll have multiple members
        const totalCount = stayingAssignments.length + addedMemberIds.length;
        const groupId = event.groupId
          || (totalCount > 1
            ? `group_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`
            : null);

        // 1) UPDATE staying members with shared fields (+ assign groupId if newly created)
        for (const a of stayingAssignments) {
          const updates = { ...sharedUpdates };
          if (groupId && !a.groupId) updates.groupId = groupId;
          dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { id: a.id, ...updates } });

          // Outlook update
          if (token) {
            const m = MEMBERS.find((mm) => mm.id === a.memberId);
            if (m && !m.skipOutlookSync) {
              if (a.outlookEventId) {
                const result = await updateCalendarEvent(token, m.email, a.outlookEventId, {
                  subject: editTitle,
                  start: { dateTime: `${editDate}T${editStartTime}:00`, timeZone: 'Asia/Tokyo' },
                  end: { dateTime: `${editDate}T${editEndTime}:00`, timeZone: 'Asia/Tokyo' },
                  location: { displayName: editLocation || '' },
                  body: { contentType: 'Text', content: buildEventBody(editMemo || '') },
                });
                if (!result.success) outlookErrors.push(`${m.nameJa}: ${result.error}`);
              } else {
                // No outlookEventId yet — create one
                const result = await createCalendarEvent(token, m.email, {
                  subject: editTitle,
                  start: { dateTime: `${editDate}T${editStartTime}:00`, timeZone: 'Asia/Tokyo' },
                  end: { dateTime: `${editDate}T${editEndTime}:00`, timeZone: 'Asia/Tokyo' },
                  location: { displayName: editLocation || '' },
                  body: { contentType: 'Text', content: buildEventBody(editMemo || '') },
                });
                if (result.success && result.data?.id) {
                  dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { id: a.id, outlookEventId: result.data.id } });
                } else if (!result.success) {
                  outlookErrors.push(`${m.nameJa}: ${result.error}`);
                }
              }
            }
          }
        }

        // 2) ADD newly selected members
        for (const memberId of addedMemberIds) {
          const m = MEMBERS.find((mm) => mm.id === memberId);
          let outlookEventId = null;
          if (token && m && !m.skipOutlookSync) {
            const result = await createCalendarEvent(token, m.email, {
              subject: editTitle,
              start: { dateTime: `${editDate}T${editStartTime}:00`, timeZone: 'Asia/Tokyo' },
              end: { dateTime: `${editDate}T${editEndTime}:00`, timeZone: 'Asia/Tokyo' },
              location: { displayName: editLocation || '' },
              body: { contentType: 'Text', content: buildEventBody(editMemo || '') },
            });
            if (result.success) outlookEventId = result.data?.id || null;
            else outlookErrors.push(`${m?.nameJa || memberId}: ${result.error}`);
          }
          dispatch({
            type: 'ADD_ASSIGNMENT',
            payload: {
              sourceType: event.sourceType || 'manual',
              opportunityId: event.opportunityId || null,
              opportunityName: editTitle,
              accountName: event.accountName || null,
              category: event.category || null,
              status: event.status || null,
              stage: event.stage || null,
              memberId,
              memberEmail: m?.email || null,
              date: editDate,
              startTime: editStartTime,
              endTime: editEndTime,
              isAllDay: event.isAllDay || false,
              isDelivery: event.isDelivery || false,
              syncOutlook: syncToOutlook,
              address: editLocation,
              scheduleMemo: editMemo,
              outlookEventId,
              groupId,
            },
          });
        }

        // 3) DELETE removed members
        for (const a of removedAssignments) {
          if (token && a.outlookEventId) {
            const m = MEMBERS.find((mm) => mm.id === a.memberId);
            if (m && !m.skipOutlookSync) {
              const result = await deleteCalendarEvent(token, m.email, a.outlookEventId);
              if (!result.success) outlookErrors.push(`${m.nameJa}: ${result.error}`);
            }
          }
          dispatch({ type: 'DELETE_ASSIGNMENT', payload: a.id });
        }
      } else if (isOutlook && token) {
        // Pure Outlook event — update only this one
        const result = await updateCalendarEvent(token, event.memberEmail, event.id, {
          subject: editTitle,
          start: { dateTime: `${editDate}T${editStartTime}:00`, timeZone: 'Asia/Tokyo' },
          end: { dateTime: `${editDate}T${editEndTime}:00`, timeZone: 'Asia/Tokyo' },
          location: { displayName: editLocation || '' },
          body: { contentType: 'Text', content: buildEventBody(editMemo || '') },
        });
        if (!result.success) {
          outlookErrors.push(`${event.memberEmail}: ${result.error}`);
        } else {
          setEvents(
            events.map((e) =>
              e.id === event.id
                ? { ...e, title: editTitle, start: `${editDate}T${editStartTime}:00`, end: `${editDate}T${editEndTime}:00`, location: editLocation }
                : e
            )
          );
        }
      }

      if (outlookErrors.length > 0) {
        setError(`Outlook同期エラー:\n${outlookErrors.join('\n')}`);
        setSaving(false);
        return;
      }

      setEditMode(false);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isManualAssignment) {
        dispatch({ type: 'DELETE_ASSIGNMENT', payload: event.id });
      }

      // Delete from Outlook if it's an Outlook event
      if ((isOutlook || event.outlookEventId) && isAuthenticated) {
        const token = await getToken();
        const memberEmail = event.memberEmail || member?.email;
        const eventId = event.id || event.outlookEventId;

        if (memberEmail && eventId) {
          const result = await deleteCalendarEvent(token, memberEmail, eventId);
          if (!result.success) {
            setError(`Outlook削除エラー: ${result.error}`);
            setSaving(false);
            return;
          }

          // Remove from CalendarContext
          setEvents(events.filter((e) => e.id !== eventId));
        }
      }

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop (lighter & not blocking — modal is draggable so user may want to see the calendar) */}
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden max-h-[80vh] flex flex-col pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
          style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        >
          {/* Drag handle bar (colored top — drag here to move) */}
          <div
            className="h-2 shrink-0 cursor-move"
            style={{ backgroundColor: member?.color || '#6B7280' }}
            onMouseDown={handleHeaderMouseDown}
            title="ドラッグで移動"
          />

          <div
            className="px-6 py-4 overflow-y-auto"
            style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}
          >
            {/* Title & close (also draggable) */}
            <div
              className="flex items-start justify-between mb-4 cursor-move select-none"
              onMouseDown={handleHeaderMouseDown}
            >
              <h2 className="text-lg font-bold text-gray-800 leading-tight pr-4">
                {editMode ? '予定を編集' : (
                  event.opportunityId ? (
                    <a
                      href={`https://altenergyinc.my.salesforce.com/lightning/r/${event.sourceType === 'maintenance' ? 'Maintenance__c' : 'Opportunity'}/${event.opportunityId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-blue-700"
                      title="Salesforceで開く"
                    >
                      {event.opportunityName || event.title || 'イベント詳細'}
                    </a>
                  ) : (event.opportunityName || event.title || event.statusLabel || 'イベント詳細')
                )}
              </h2>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-gray-100 transition flex-shrink-0"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            {editMode ? (
              /* ===== EDIT MODE ===== */
              <div className="space-y-4">
                {/* Title */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">タイトル</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="予定のタイトル"
                  />
                </div>

                {/* Date */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">日付</label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Time */}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">開始時間</label>
                    <select
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">終了時間</label>
                    <select
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    >
                      {TIME_OPTIONS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Members (multi-select) */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    担当者 <span className="text-red-500">*</span>
                    {editMemberIds.length > 0 && (
                      <span className="ml-2 text-blue-600">({editMemberIds.length}名)</span>
                    )}
                    {isManualAssignment && (
                      <span className="ml-2 text-gray-400 text-[10px]">チェック追加/解除で割当を一括変更</span>
                    )}
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {MEMBERS.map((m) => {
                      const isSelected = editMemberIds.includes(m.id);
                      // For pure Outlook events, only allow selecting the original member
                      const disabled = !isManualAssignment && m.id !== event.memberId;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && toggleEditMember(m.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm transition ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-800 ring-1 ring-blue-500'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                          } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                          {m.nameJa}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Location */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">場所</label>
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    placeholder="場所（任意）"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* Memo */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">メモ</label>
                  <textarea
                    value={editMemo}
                    onChange={(e) => setEditMemo(e.target.value)}
                    rows={3}
                    placeholder="メモ（任意）"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-y"
                  />
                </div>

                {/* Outlook sync checkbox */}
                {isAuthenticated && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncToOutlook}
                      onChange={(e) => setSyncToOutlook(e.target.checked)}
                      className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">
                      {(isOutlook || event.outlookEventId) ? 'Outlookに反映' : 'Outlookに登録'}
                    </span>
                  </label>
                )}
              </div>
            ) : (
              /* ===== READ-ONLY MODE ===== */
              <div className="space-y-3">
                {/* Date & time */}
                {eventDate && (
                  <DetailRow
                    icon={
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    }
                    label="日時"
                  >
                    <span className="text-sm text-gray-800">
                      {eventDate}
                      {startTime && endTime && (
                        <span className="text-gray-500 ml-2">{startTime} - {endTime}</span>
                      )}
                    </span>
                  </DetailRow>
                )}

                {/* Member */}
                {member && (
                  <DetailRow
                    icon={
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    }
                    label="担当者"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: member.color }}
                      />
                      <span className="text-sm text-gray-800">{member.nameJa}</span>
                      <span className="text-xs text-gray-400">{member.email}</span>
                    </div>
                  </DetailRow>
                )}

                {/* Location */}
                {(event.location || event.address) && (
                  <DetailRow
                    icon={
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    }
                    label="場所"
                  >
                    <span className="text-sm text-gray-800">{event.location || event.address}</span>
                  </DetailRow>
                )}

                {/* Source */}
                <DetailRow
                  icon={
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  }
                  label="ソース"
                >
                  <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${sourceBadgeClass}`}>
                    {sourceLabel}
                  </span>
                </DetailRow>

                {/* Assignment-specific fields */}
                {isAssignment && (
                  <>
                    {event.accountName && (
                      <DetailRow
                        icon={
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        }
                        label="取引先"
                      >
                        <span className="text-sm text-gray-800">{event.accountName}</span>
                      </DetailRow>
                    )}

                    {event.stage && (
                      <DetailRow
                        icon={
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        }
                        label="フェーズ"
                      >
                        <span className="text-sm text-gray-800">{event.stage}</span>
                      </DetailRow>
                    )}

                    {event.scheduleMemo && (
                      <DetailRow
                        icon={
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        }
                        label="メモ"
                      >
                        <span className="text-sm text-gray-800">{event.scheduleMemo}</span>
                      </DetailRow>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between items-center gap-3 mt-6 pt-4 border-t border-gray-100">
              {/* Left side: delete */}
              <div>
                {(isManualAssignment || isOutlook) && !editMode && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className={`px-4 py-2 text-sm rounded-lg transition font-medium ${
                      deleteConfirm
                        ? 'text-white bg-red-600 hover:bg-red-700'
                        : 'text-red-600 hover:bg-red-50'
                    } disabled:opacity-50`}
                  >
                    {deleteConfirm ? '本当に削除' : '削除'}
                  </button>
                )}
                {editMode && (
                  <button
                    onClick={handleDelete}
                    disabled={saving}
                    className={`px-4 py-2 text-sm rounded-lg transition font-medium ${
                      deleteConfirm
                        ? 'text-white bg-red-600 hover:bg-red-700'
                        : 'text-red-600 hover:bg-red-50'
                    } disabled:opacity-50`}
                  >
                    {deleteConfirm ? '本当に削除' : '削除'}
                  </button>
                )}
              </div>

              {/* Right side: edit/save/cancel/close */}
              <div className="flex gap-2">
                {editMode ? (
                  <>
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition disabled:opacity-50"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition font-medium disabled:opacity-50 flex items-center gap-1"
                    >
                      {saving && (
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      )}
                      保存
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={onClose}
                      className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
                    >
                      閉じる
                    </button>
                    {(isManualAssignment || isOutlook) && (
                      <button
                        onClick={handleEnterEditMode}
                        className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition font-medium"
                      >
                        編集
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Reusable detail row with icon.
 */
function DetailRow({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 bg-gray-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {icon}
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        {children}
      </div>
    </div>
  );
}
