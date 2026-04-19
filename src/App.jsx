import { useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CalendarProvider } from './context/CalendarContext';
import { AppProvider, useApp } from './context/AppContext';
import MainLayout from './components/layout/MainLayout';
import MonthlyView from './components/schedule/MonthlyView';
import WeeklyView from './components/schedule/WeeklyView';
import DailyView from './components/schedule/DailyView';
import SettingsView from './components/settings/SettingsView';
import AssignModal from './components/schedule/AssignModal';
import EventDetailModal from './components/schedule/EventDetailModal';
import QuickAddModal from './components/schedule/QuickAddModal';
import LoginGate from './components/auth/LoginGate';

function AuthenticatedApp() {
  const { isAuthenticated, loading } = useAuth();
  if (loading || !isAuthenticated) {
    return <LoginGate />;
  }
  return (
    <CalendarProvider>
      <AppProvider>
        <AppInner />
      </AppProvider>
    </CalendarProvider>
  );
}

function AppInner() {
  const { dispatch } = useApp();

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
    // Paste copied event to this slot
    if (copiedEvent) {
      const startMinutes = parseInt(time.substring(0, 2)) * 60 + parseInt(time.substring(3, 5));
      const origStart = (parseInt(copiedEvent.startTime?.substring(0, 2) || '0') * 60) + parseInt(copiedEvent.startTime?.substring(3, 5) || '0');
      const origEnd = (parseInt(copiedEvent.endTime?.substring(0, 2) || '0') * 60) + parseInt(copiedEvent.endTime?.substring(3, 5) || '0');
      const duration = origEnd - origStart;
      const newEndMinutes = Math.min(startMinutes + duration, 24 * 60);
      const newEndTime = `${String(Math.floor(newEndMinutes / 60)).padStart(2, '0')}:${String(newEndMinutes % 60).padStart(2, '0')}`;

      dispatch({
        type: 'ADD_ASSIGNMENT',
        payload: {
          ...copiedEvent,
          id: undefined,
          memberId,
          date,
          startTime: time,
          endTime: newEndTime,
        },
      });
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

  // Keyboard shortcuts: Escape, Ctrl+C, Delete
  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (pickedJob) setPickedJob(null);
      else if (copiedEvent) setCopiedEvent(null);
      else if (activeEvent) setActiveEvent(null);
    }
    if (e.key === 'Delete' && activeEvent && activeEvent.opportunityName) {
      // Delete selected assignment
      if (confirm(`「${activeEvent.opportunityName}」を削除しますか？`)) {
        dispatch({ type: 'DELETE_ASSIGNMENT', payload: activeEvent.id });
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
      {/* Copied event banner */}
      {copiedEvent && !pickedJob && (
        <div
          className="fixed top-0 left-0 right-0 z-50 bg-blue-500 text-white text-center py-2 text-sm font-medium shadow-lg cursor-pointer"
          onClick={() => setCopiedEvent(null)}
        >
          📋 「{copiedEvent.opportunityName}」をコピー済み — スロットをクリックして貼り付け （クリック/Escでキャンセル）
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
