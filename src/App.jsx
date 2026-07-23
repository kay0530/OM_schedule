import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CalendarProvider, useCalendar } from './context/CalendarContext';
import { AppProvider, useApp } from './context/AppContext';
import { MEMBERS } from './data/members';
import { createEventForMember, updateEventForMember, deleteEventForMember, fetchEventForMember } from './services/graphCalendarService';
import { buildEventBody } from './services/eventBodyTemplate';
import { addDays, toGraphDateTime } from './utils/dateUtils';
import { ToastProvider, useToastContext } from './components/shared/Toast';
import MainLayout from './components/layout/MainLayout';
import MonthlyView from './components/schedule/MonthlyView';
import WeeklyView from './components/schedule/WeeklyView';
import DailyView from './components/schedule/DailyView';
import SettingsView from './components/settings/SettingsView';
import AssignModal from './components/schedule/AssignModal';
import EventDetailModal from './components/schedule/EventDetailModal';
import QuickAddModal from './components/schedule/QuickAddModal';
import LoginGate from './components/auth/LoginGate';
import ThemeApplier from './components/shared/ThemeApplier';
import { SfDataProvider } from './context/SfDataContext';

/**
 * The grid slot an existing event occupies, so a click on the event can be
 * treated as a click on the slot beneath it (placing on top of it).
 *
 * @param {object} ev - the clicked event/assignment
 * @param {{date?: string, memberId?: string}} [cell] - the cell the chip was
 *   rendered in. It WINS over the event's own values: a multi-day all-day
 *   event is drawn in every covered column but always carries its original
 *   start date, so without this a click on Thursday's chip would place the new
 *   schedule back on Monday.
 * @returns {{date: string, time: string, memberId: string}|null}
 */
function slotFromEvent(ev, cell) {
  if (!ev) return null;
  const date = cell?.date || ev.date || ev.start?.substring(0, 10) || null;
  // All-day chips have no meaningful clock time — use the working-day start,
  // matching what the all-day cells pass to onSlotDoubleClick.
  const time = ev.isAllDay ? '08:00' : (ev.startTime || ev.start?.substring(11, 16) || null);
  // Outlook events carry memberKey (member id, or the raw email when the
  // address isn't in MEMBER_EMAIL_MAP — e.g. the 納品 calendar), so fall back
  // to matching the address against the member list.
  const memberId = cell?.memberId
    || ev.memberId
    || (MEMBERS.some((m) => m.id === ev.memberKey) ? ev.memberKey : null)
    || MEMBERS.find((m) => (m.email || '').toLowerCase() === (ev.memberEmail || '').toLowerCase())?.id
    || null;
  return date && time && memberId ? { date, time, memberId } : null;
}

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useAuth();
  if (loading || !isAuthenticated) {
    return <LoginGate />;
  }
  return (
    <CalendarProvider>
      <AppProvider>
        <SfDataProvider>
          <ToastProvider>
            <ThemeApplier />
            <AppInner />
          </ToastProvider>
        </SfDataProvider>
      </AppProvider>
    </CalendarProvider>
  );
}

function AppInner() {
  const { assignments, dispatch } = useApp();
  const { events, setEvents } = useCalendar();
  const { isAuthenticated, getToken } = useAuth();
  const { addToast } = useToastContext();

  // Reconcile assignments with edits made on the Outlook side: when an
  // Outlook event matching an assignment's outlookEventId differs from the
  // assignment's stored values, pull the latest values from Outlook into the
  // assignment. Avoids the "duplicate event" problem after editing on Outlook.
  // Depend only on `events` (and read latest assignments via ref) so this
  // does not re-fire on every assignment dispatch — which previously caused
  // Firestore write storms ("resource-exhausted").
  const assignmentsRef = useRef(assignments);
  assignmentsRef.current = assignments;
  useEffect(() => {
    if (!events || events.length === 0) return;
    const current = assignmentsRef.current;
    if (current.length === 0) return;
    const eventById = new Map(events.map((e) => [e.id, e]));
    for (const a of current) {
      if (!a.outlookEventId) continue;
      const oe = eventById.get(a.outlookEventId);
      if (!oe) continue;
      const newTitle = oe.title || '';
      const newDate = oe.start?.substring(0, 10) || a.date;
      const newStart = oe.start?.substring(11, 16) || a.startTime;
      const newEnd = oe.end?.substring(11, 16) || a.endTime;
      const newLocation = oe.location || '';
      const updates = {};
      if (newTitle && newTitle !== a.opportunityName) {
        updates.opportunityName = newTitle;
        updates.title = newTitle;
      }
      if (newDate && newDate !== a.date) updates.date = newDate;
      // All-day handling: Outlook stores all-day events as midnight→next-day
      // midnight, while assignments use the local 00:00/24:00 convention — so
      // times are only reconciled for timed events. A timed⇄all-day conversion
      // made on the Outlook side must also flip the local flag (single dispatch
      // converges, so no reconcile loop / write storm).
      const oeAllDay = !!oe.isAllDay;
      if (oeAllDay !== !!a.isAllDay) {
        updates.isAllDay = oeAllDay;
        if (oeAllDay) {
          // Converted to all-day — adopt the local sentinel times
          if (a.startTime !== '00:00') updates.startTime = '00:00';
          if (a.endTime !== '24:00') updates.endTime = '24:00';
        } else {
          if (newStart) updates.startTime = newStart;
          if (newEnd) updates.endTime = newEnd;
        }
      } else if (!oeAllDay) {
        if (newStart && newStart !== a.startTime) updates.startTime = newStart;
        if (newEnd && newEnd !== a.endTime) updates.endTime = newEnd;
      }
      if (newLocation !== (a.address || '')) updates.address = newLocation;
      if (Object.keys(updates).length > 0) {
        dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { id: a.id, ...updates } });
      }
    }
  }, [events, dispatch]);

  const [activeView, setActiveView] = useState('weekly');
  const [viewParams, setViewParams] = useState({});
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignPresets, setAssignPresets] = useState({});

  // "Picked" job from the panel — click a slot to place it
  const [pickedJob, setPickedJob] = useState(null);

  // Event detail modal state
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetailOpen, setEventDetailOpen] = useState(false);

  // Quick-add modal state (double-click on empty slot)
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPresets, setQuickAddPresets] = useState({});

  // Active (selected) event for copy-paste
  const [activeEvent, setActiveEvent] = useState(null);
  const [copiedEvent, setCopiedEvent] = useState(null);
  // Last-clicked empty slot — the paste destination for Ctrl+V
  // (Excel/Outlook model: click target cell first, then Ctrl+V pastes there)
  const [selectedSlot, setSelectedSlot] = useState(null); // {date, time, memberId}
  // Fallback flow: Ctrl+V pressed with no slot selected arms paste-on-click
  const [pasteArmed, setPasteArmed] = useState(false);

  function navigate(view, params = {}) {
    setActiveView(view);
    setViewParams(params);
  }

  // Called when an opportunity is clicked in the JobPanel
  function handleSelectOpportunity(opportunity) {
    if (pickedJob && pickedJob.id === opportunity.id) {
      setSelectedOpportunity(opportunity);
      setAssignModalOpen(true);
      setPickedJob(null);
    } else {
      setPickedJob(opportunity);
    }
  }

  // Paste the copied event at the given slot
  function pasteAt(date, time, memberId) {
    if (!copiedEvent) return;
    const isAllDayCopy = !!copiedEvent.isAllDay;
    let newStartTime;
    let newEndTime;
    if (isAllDayCopy) {
      // All-day: preserve 終日 nature regardless of clicked time
      newStartTime = '00:00';
      newEndTime = '24:00';
    } else {
      const startMinutes = parseInt(time.substring(0, 2)) * 60 + parseInt(time.substring(3, 5));
      const origStart = (parseInt(copiedEvent.startTime?.substring(0, 2) || '0') * 60) + parseInt(copiedEvent.startTime?.substring(3, 5) || '0');
      const origEnd = (parseInt(copiedEvent.endTime?.substring(0, 2) || '0') * 60) + parseInt(copiedEvent.endTime?.substring(3, 5) || '0');
      const duration = origEnd - origStart;
      const newEndMinutes = Math.min(startMinutes + duration, 24 * 60);
      newStartTime = time;
      newEndTime = `${String(Math.floor(newEndMinutes / 60)).padStart(2, '0')}:${String(newEndMinutes % 60).padStart(2, '0')}`;
    }

    dispatch({
      type: 'ADD_ASSIGNMENT',
      payload: {
        ...copiedEvent,
        id: undefined,
        memberId,
        date,
        startTime: newStartTime,
        endTime: newEndTime,
        isAllDay: isAllDayCopy,
        // Reset Outlook linkage — paste creates a brand new draft
        outlookEventId: null,
        groupId: null,
      },
    });
    setPasteArmed(false);
    setSelectedSlot(null);
  }

  // Called when a slot is clicked in WeeklyView (single click)
  const handleSlotClick = useCallback((date, time, memberId) => {
    if (pickedJob) {
      setSelectedOpportunity(pickedJob);
      const startH = parseInt(time.substring(0, 2));
      const endTime = `${String(Math.min(startH + 8, 24)).padStart(2, '0')}:00`;
      setAssignPresets({ preselectedMember: memberId, preselectedDate: date, startTime: time, endTime });
      setAssignModalOpen(true);
      setPickedJob(null);
      // Placing a job consumes the click — an armed paste must not stay armed
      // and silently fire on the next slot click after the modal closes.
      setPasteArmed(false);
      return;
    }
    // Armed paste-on-click (fallback flow: Ctrl+V pressed before choosing a slot)
    if (copiedEvent && pasteArmed) {
      pasteAt(date, time, memberId);
      return;
    }
    // Remember the clicked slot as the paste destination & deselect event
    setSelectedSlot({ date, time, memberId });
    setActiveEvent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedJob, copiedEvent, pasteArmed]);

  // Called on double-click on empty slot — quick add (no SF job)
  function handleSlotDoubleClick(date, time, memberId, options) {
    if (pickedJob) {
      handleSlotClick(date, time, memberId);
      return;
    }
    setQuickAddPresets({ presetDate: date, presetTime: time, presetMemberId: memberId, presetAllDay: options?.isAllDay || false, presetIsDelivery: options?.isDelivery || false });
    setQuickAddOpen(true);
  }

  // Called when a job card is dropped onto a calendar cell
  function handleDropJob(jobData, date, memberId, startTime, endTime) {
    setSelectedOpportunity(jobData);
    setAssignPresets({ preselectedMember: memberId, preselectedDate: date, startTime, endTime });
    setAssignModalOpen(true);
    setPickedJob(null);
  }

  function handleCloseModal() {
    setAssignModalOpen(false);
    setSelectedOpportunity(null);
    setAssignPresets({});
  }

  // Single click on event = activate (select). While a job is picked or an
  // event is copied, a click on an existing event still means "place here" —
  // otherwise a schedule could never be put ON TOP of an existing one, since
  // the chip covers the slot. Covers chips the placement-mode CSS can't reach
  // (all-day row, monthly view), which have no slot handler underneath.
  const handleEventClick = useCallback((event, cell) => {
    const slot = slotFromEvent(event, cell);
    if (slot && (pickedJob || (copiedEvent && pasteArmed))) {
      handleSlotClick(slot.date, slot.time, slot.memberId);
      return;
    }
    setActiveEvent(event);
    // Holding a clipboard: also mark the slot this event sits on as the paste
    // destination, so Ctrl+V can drop a copy on top of it.
    if (copiedEvent && slot) setSelectedSlot(slot);
  }, [pickedJob, copiedEvent, pasteArmed, handleSlotClick]);

  // Double click on event = open detail modal.
  // Suppressed while a placement modal is opening: the first click of a
  // double-click on an all-day/monthly chip already placed the job, and the
  // detail modal would then stack on top of the assign/quick-add modal.
  const handleEventDoubleClick = useCallback((event) => {
    if (pickedJob || assignModalOpen || quickAddOpen) return;
    setSelectedEvent(event);
    setEventDetailOpen(true);
  }, [pickedJob, assignModalOpen, quickAddOpen]);

  function handleCloseEventDetail() {
    setEventDetailOpen(false);
    setSelectedEvent(null);
  }

  // Drag-move / resize of an assignment. Dispatches the local update
  // optimistically, then mirrors the change to Outlook for synced assignments —
  // without this the reconcile sweep pulls the (unmoved) Outlook times back and
  // the move is silently undone at the next Outlook同期.
  const movesInFlightRef = useRef(new Set());
  const handleMoveAssignment = useCallback(async (payload) => {
    const a = assignmentsRef.current.find((x) => x.id === payload.id);
    if (!a) return;
    // One mirror at a time per assignment: a second drag mid-flight would read
    // a stale outlookEventId and strand a duplicate on the intermediate
    // member's calendar (Graph DELETE 404 masks the double-delete).
    if (a.outlookEventId && movesInFlightRef.current.has(a.id)) {
      addToast('前の移動をOutlookへ反映中です。完了後にもう一度お試しください。', 'warning');
      return;
    }
    const prev = {
      date: a.date,
      startTime: a.startTime,
      endTime: a.endTime,
      memberId: a.memberId,
      memberEmail: a.memberEmail,
    };
    dispatch({ type: 'UPDATE_ASSIGNMENT', payload });

    if (!a.outlookEventId) return; // draft (仮) — nothing to mirror

    movesInFlightRef.current.add(a.id);
    try {
      const revert = (reason) => {
        dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { id: a.id, ...prev } });
        addToast(`Outlookへ反映できなかったため移動を元に戻しました。\n${reason}`, 'error', 0);
      };

      const token = isAuthenticated ? await getToken().catch(() => null) : null;
      if (!token) {
        revert('MS365にログインしていません。ログイン後にやり直してください。');
        return;
      }

      const newDate = payload.date || a.date;
      const newStart = payload.startTime || a.startTime;
      const newEnd = payload.endTime || a.endTime;
      // Timed-grid moves only reach here, but keep the all-day payload correct
      // defensively (midnight → next-day midnight per Graph convention)
      const timePatch = a.isAllDay
        ? {
            isAllDay: true,
            start: { dateTime: `${newDate}T00:00:00`, timeZone: 'Asia/Tokyo' },
            end: { dateTime: `${addDays(newDate)}T00:00:00`, timeZone: 'Asia/Tokyo' },
          }
        : {
            isAllDay: false,
            start: { dateTime: `${newDate}T${newStart}:00`, timeZone: 'Asia/Tokyo' },
            end: { dateTime: toGraphDateTime(newDate, newEnd), timeZone: 'Asia/Tokyo' },
          };
      // Cache times mirroring timePatch — the cached Outlook copy MUST be
      // updated after a successful write, or the reconcile sweep (which runs
      // on every events change) reads the stale cache and reverts the move.
      const cacheStart = a.isAllDay ? `${newDate}T00:00:00` : `${newDate}T${newStart}:00`;
      const cacheEnd = a.isAllDay ? `${addDays(newDate)}T00:00:00` : toGraphDateTime(newDate, newEnd);

      const newMemberId = payload.memberId || a.memberId;
      if (newMemberId === a.memberId) {
        // Same calendar — a single PATCH moves it
        const m = MEMBERS.find((mm) => mm.id === a.memberId) || { email: a.memberEmail };
        const result = await updateEventForMember(token, m, a.outlookEventId, timePatch);
        if (!result.success) {
          revert(result.error);
        } else {
          setEvents((prevEvents) => prevEvents.map((e) =>
            e.id === a.outlookEventId ? { ...e, start: cacheStart, end: cacheEnd, isAllDay: !!a.isAllDay } : e
          ));
        }
        return;
      }

      // Cross-member: the event lives in the source member's calendar, so it
      // must be re-created on the target and deleted from the source.
      // Create FIRST so the event can never be lost (worst case: a duplicate,
      // which we surface below).
      const targetMember = MEMBERS.find((mm) => mm.id === newMemberId);
      if (!targetMember) {
        revert('移動先のメンバーが見つかりません。');
        return;
      }
      const sourceMember = MEMBERS.find((mm) => mm.id === a.memberId) || { email: a.memberEmail };

      // Carry the ORIGINAL event content over — the body holds the crew's
      // 作業報告 text (parsed by the 活動報告 export) and may have been edited
      // in Outlook after creation. Fall back to local fields if the read fails
      // (the move itself still works; only content carry-over degrades).
      let subject = a.opportunityName || a.title || '';
      let bodyContent = buildEventBody(a.scheduleMemo || '');
      let locationName = a.address || '';
      const orig = await fetchEventForMember(token, sourceMember, a.outlookEventId);
      if (orig.success && orig.data) {
        if (orig.data.subject) subject = orig.data.subject;
        if (orig.data.body?.content) bodyContent = orig.data.body.content;
        if (orig.data.location?.displayName != null) locationName = orig.data.location.displayName;
      }

      const created = await createEventForMember(token, targetMember, {
        subject,
        ...timePatch,
        location: { displayName: locationName },
        body: { contentType: 'Text', content: bodyContent },
      });
      if (!created.success) {
        revert(created.error);
        return;
      }
      const oldOutlookId = a.outlookEventId;
      dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { id: a.id, outlookEventId: created.data?.id || null } });
      const del = await deleteEventForMember(token, sourceMember, oldOutlookId);
      if (del.success) {
        // Prune the cached copy so the old member's column doesn't show a ghost
        setEvents((prevEvents) => prevEvents.filter((e) => e.id !== oldOutlookId));
      } else {
        addToast(
          `移動先(${targetMember.nameJa})のOutlookには登録しましたが、元の担当者(${sourceMember.nameJa || sourceMember.email})の旧予定を削除できませんでした。Outlook上で削除してください。\n${del.error}`,
          'error',
          0
        );
      }
    } finally {
      movesInFlightRef.current.delete(a.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, isAuthenticated, getToken, setEvents, addToast]);

  // Keyboard shortcuts: Escape, Ctrl+C, Ctrl+V, Delete
  function handleKeyDown(e) {
    // Don't hijack typing inside form fields
    const tag = (e.target?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) {
      return;
    }

    if (e.key === 'Escape') {
      if (pickedJob) setPickedJob(null);
      else if (pasteArmed) setPasteArmed(false);
      else if (copiedEvent) setCopiedEvent(null);
      else if (activeEvent) setActiveEvent(null);
      else if (selectedSlot) setSelectedSlot(null);
    }
    if (e.key === 'Delete' && activeEvent && activeEvent.opportunityName) {
      // Delete selected assignment (group-aware + Outlook-aware)
      const targets = activeEvent.groupId
        ? assignments.filter((a) => a.groupId === activeEvent.groupId)
        : [activeEvent];
      const label = targets.length > 1
        ? `「${activeEvent.opportunityName}」を${targets.length}名分まとめて削除しますか？\n（Outlook送信済みの予定はOutlookからも削除されます）`
        : `「${activeEvent.opportunityName}」を削除しますか？`;
      if (confirm(label)) {
        // Best-effort Outlook delete in the background; local delete is immediate
        (async () => {
          const token = isAuthenticated ? await getToken().catch(() => null) : null;
          const failed = [];
          for (const t of targets) {
            if (!t.outlookEventId) continue;
            if (!token) continue; // can't reach Outlook — leave the cached event alone
            const m = MEMBERS.find((mm) => mm.id === t.memberId);
            const memberEmail = m?.email || t.memberEmail;
            if (!memberEmail) continue;
            // deleteEventForMember never throws; 404 (already gone) counts as success
            const result = await deleteEventForMember(token, m || { email: memberEmail }, t.outlookEventId);
            if (result.success) {
              // Prune the cached Outlook copy so it doesn't reappear as a
              // ghost chip once the assignment (and its dedup link) is gone
              setEvents((prev) => prev.filter((e) => e.id !== t.outlookEventId));
            } else {
              failed.push(`${m?.nameJa || memberEmail}: ${result.error}`);
            }
          }
          if (failed.length > 0) {
            addToast(`Outlook側の削除に失敗しました:\n${failed.join('\n')}\n（予定がOutlookに残っています。再同期で再表示された場合はOutlook上で削除してください）`, 'error', 0);
          }
        })();
        for (const t of targets) {
          dispatch({ type: 'DELETE_ASSIGNMENT', payload: t.id });
        }
        setActiveEvent(null);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && activeEvent) {
      e.preventDefault();
      const st = activeEvent.startTime || activeEvent.start?.substring(11, 16) || '08:00';
      const et = activeEvent.endTime || activeEvent.end?.substring(11, 16) || '09:00';
      const copyData = {
        sourceType: activeEvent.sourceType || 'manual',
        opportunityId: activeEvent.opportunityId || null,
        opportunityName: activeEvent.opportunityName || activeEvent.title || '',
        accountName: activeEvent.accountName || null,
        category: activeEvent.category || null,
        status: activeEvent.status || null,
        stage: activeEvent.stage || null,
        address: activeEvent.address || null,
        scheduleMemo: activeEvent.scheduleMemo || null,
        startTime: st,
        endTime: et,
        isAllDay: activeEvent.isAllDay || false,
      };
      setCopiedEvent(copyData);
      setPasteArmed(false); // arming requires explicit Ctrl+V
    }
    // Ctrl+V: paste at the selected slot (Excel/Outlook model). If no slot is
    // selected yet, arm paste-on-click so the next slot click pastes.
    // e.repeat guard: holding the key auto-repeats — the 2nd firing would see
    // selectedSlot already cleared by pasteAt and silently arm paste-on-click,
    // causing an unintended duplicate on the next stray click.
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedEvent && !e.repeat) {
      e.preventDefault();
      if (selectedSlot) {
        pasteAt(selectedSlot.date, selectedSlot.time, selectedSlot.memberId);
      } else {
        setPasteArmed(true);
      }
    }
  }

  function renderView() {
    // Same key format as the views' per-cell cellKey: `${date}-${memberId}-${hour}`
    const selectedSlotKey = selectedSlot
      ? `${selectedSlot.date}-${selectedSlot.memberId}-${parseInt(selectedSlot.time)}`
      : null;
    const commonProps = {
      navigate,
      currentDate,
      onDropJob: handleDropJob,
      onEventClick: handleEventClick,
      onEventDoubleClick: handleEventDoubleClick,
      onMoveAssignment: handleMoveAssignment,
      activeEventId: activeEvent?.id || null,
      selectedSlotKey,
    };
    switch (activeView) {
      case 'monthly':
        return <MonthlyView {...commonProps} {...viewParams} />;
      case 'weekly':
        return <WeeklyView {...commonProps} onDateChange={setCurrentDate} onSlotClick={handleSlotClick} onSlotDoubleClick={handleSlotDoubleClick} {...viewParams} />;
      case 'daily':
        return <DailyView {...commonProps} onDateChange={setCurrentDate} onSlotClick={handleSlotClick} onSlotDoubleClick={handleSlotDoubleClick} {...viewParams} />;
      case 'settings':
        return <SettingsView />;
      default:
        return <MonthlyView {...commonProps} {...viewParams} />;
    }
  }

  return (
    <>
      {/* Picked job banner */}
      {pickedJob && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-center py-2 text-sm font-medium shadow-lg cursor-pointer"
          onClick={() => setPickedJob(null)}
        >
          📌 「{pickedJob.name}」を選択中 — カレンダーのスロットをクリックして配置 （クリックでキャンセル / Escキー）
        </div>
      )}
      {/* Copied event banner — two states */}
      {copiedEvent && !pickedJob && !pasteArmed && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-gray-700 text-white text-center py-2 text-sm font-medium shadow-lg cursor-pointer"
          onClick={() => setCopiedEvent(null)}
          title="クリックでクリップボードをクリア"
        >
          📋 「{copiedEvent.opportunityName}」をコピー済み — 貼り付け先のマスをクリックして <span className="bg-white/20 px-2 py-0.5 rounded mx-1">Ctrl + V</span> （クリック/Escでクリア）
        </div>
      )}
      {copiedEvent && !pickedJob && pasteArmed && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-blue-500 text-white text-center py-2 text-sm font-medium shadow-lg cursor-pointer"
          onClick={() => setPasteArmed(false)}
          title="クリックで貼り付けモード解除"
        >
          📋 貼り付けモード — 「{copiedEvent.opportunityName}」をカレンダーのスロットをクリックして配置 （クリック/Escでキャンセル）
        </div>
      )}
      {/* data-placement-mode: while a job is picked, or paste is armed, the
          next click is meant to PLACE something on a slot — index.css turns off
          pointer events on the event chips so the click reaches the slot even
          when it is already occupied (overlapping schedules are allowed).
          Both states clear themselves the moment the placement happens, so the
          chips can never stay stuck non-interactive. A bare copiedEvent is
          deliberately NOT included: it persists for repeat-pasting, and the
          paste destination is handled in handleEventClick instead. */}
      <div
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        data-placement-mode={pickedJob || pasteArmed ? 'true' : undefined}
      >
        <MainLayout
          activeView={activeView}
          onNavigate={navigate}
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          onSelectOpportunity={handleSelectOpportunity}
          pickedJob={pickedJob}
          bannerOffset={Boolean(pickedJob || copiedEvent)}
        >
          {renderView()}
        </MainLayout>
      </div>
      <AssignModal
        isOpen={assignModalOpen}
        onClose={handleCloseModal}
        opportunity={selectedOpportunity}
        preselectedMember={assignPresets.preselectedMember}
        preselectedDate={assignPresets.preselectedDate}
        preselectedStartTime={assignPresets.startTime}
        preselectedEndTime={assignPresets.endTime}
      />
      <EventDetailModal
        isOpen={eventDetailOpen}
        onClose={handleCloseEventDetail}
        event={selectedEvent}
      />
      <QuickAddModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        presetDate={quickAddPresets.presetDate}
        presetTime={quickAddPresets.presetTime}
        presetMemberId={quickAddPresets.presetMemberId}
        presetAllDay={quickAddPresets.presetAllDay}
        presetIsDelivery={quickAddPresets.presetIsDelivery}
      />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
