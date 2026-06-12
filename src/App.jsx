import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CalendarProvider, useCalendar } from './context/CalendarContext';
import { AppProvider, useApp } from './context/AppContext';
import { MEMBERS } from './data/members';
import { deleteCalendarEvent } from './services/graphCalendarService';
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

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useAuth();
  if (loading || !isAuthenticated) {
    return <LoginGate />;
  }
  return (
    <CalendarProvider>
      <AppProvider>
        <ThemeApplier />
        <AppInner />
      </AppProvider>
    </CalendarProvider>
  );
}

function AppInner() {
  const { assignments, dispatch } = useApp();
  const { events } = useCalendar();
  const { isAuthenticated, getToken } = useAuth();

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
      if (newStart && newStart !== a.startTime) updates.startTime = newStart;
      if (newEnd && newEnd !== a.endTime) updates.endTime = newEnd;
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
  // True only after Ctrl+V: the user has explicitly armed paste-on-click.
  // Without this, a stray click on the calendar would paste unintentionally.
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

  // Called when a slot is clicked in WeeklyView (single click)
  function handleSlotClick(date, time, memberId) {
    if (pickedJob) {
      setSelectedOpportunity(pickedJob);
      const startH = parseInt(time.substring(0, 2));
      const endTime = `${String(Math.min(startH + 8, 24)).padStart(2, '0')}:00`;
      setAssignPresets({ preselectedMember: memberId, preselectedDate: date, startTime: time, endTime });
      setAssignModalOpen(true);
      setPickedJob(null);
      return;
    }
    // Paste copied event to this slot — only if user explicitly pressed Ctrl+V
    if (copiedEvent && pasteArmed) {
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
      setPasteArmed(false); // single-shot paste
      return;
    }
    // Deselect active event when clicking empty slot
    setActiveEvent(null);
  }

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

  // Single click on event = activate (select)
  const handleEventClick = useCallback((event) => {
    if (pickedJob) return;
    setActiveEvent(event);
  }, [pickedJob]);

  // Double click on event = open detail modal
  const handleEventDoubleClick = useCallback((event) => {
    if (pickedJob) return;
    setSelectedEvent(event);
    setEventDetailOpen(true);
  }, [pickedJob]);

  function handleCloseEventDetail() {
    setEventDetailOpen(false);
    setSelectedEvent(null);
  }

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
          for (const t of targets) {
            if (token && t.outlookEventId) {
              const m = MEMBERS.find((mm) => mm.id === t.memberId);
              const memberEmail = m?.email || t.memberEmail;
              if (memberEmail && !m?.skipOutlookSync) {
                try { await deleteCalendarEvent(token, memberEmail, t.outlookEventId); } catch { /* ignore */ }
              }
            }
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
    // Ctrl+V: arm paste-on-click. Requires something to have been copied first.
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && copiedEvent) {
      e.preventDefault();
      setPasteArmed(true);
    }
  }

  function renderView() {
    const commonProps = {
      navigate,
      currentDate,
      onDropJob: handleDropJob,
      onEventClick: handleEventClick,
      onEventDoubleClick: handleEventDoubleClick,
      activeEventId: activeEvent?.id || null,
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
          📋 「{copiedEvent.opportunityName}」をコピー済み — <span className="bg-white/20 px-2 py-0.5 rounded mx-1">Ctrl + V</span> で貼り付けモードに （クリック/Escでクリア）
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
      <div onKeyDown={handleKeyDown} tabIndex={-1} className={pickedJob || copiedEvent ? 'pt-10' : ''}>
        <MainLayout
          activeView={activeView}
          onNavigate={navigate}
          currentDate={currentDate}
          onDateChange={setCurrentDate}
          onSelectOpportunity={handleSelectOpportunity}
          pickedJob={pickedJob}
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
