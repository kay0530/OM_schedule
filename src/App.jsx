import { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { CalendarProvider } from './context/CalendarContext';
import { AppProvider } from './context/AppContext';
import MainLayout from './components/layout/MainLayout';
import MonthlyView from './components/schedule/MonthlyView';
import WeeklyView from './components/schedule/WeeklyView';
import DailyView from './components/schedule/DailyView';
import SettingsView from './components/settings/SettingsView';
import AssignModal from './components/schedule/AssignModal';
import EventDetailModal from './components/schedule/EventDetailModal';
import QuickAddModal from './components/schedule/QuickAddModal';

export default function App() {
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

  function navigate(view, params = {}) {
    setActiveView(view);
    setViewParams(params);
  }

  // Called when an opportunity is clicked in the JobPanel
  // First click = pick (select), second click on same = open modal directly
  function handleSelectOpportunity(opportunity) {
    if (pickedJob && pickedJob.id === opportunity.id) {
      // Same job clicked again — open modal without presets
      setSelectedOpportunity(opportunity);
      setAssignModalOpen(true);
      setPickedJob(null);
    } else {
      // Pick this job — waiting for slot click
      setPickedJob(opportunity);
    }
  }

  // Called when a slot is clicked in WeeklyView (single click)
  function handleSlotClick(date, time, memberId) {
    if (pickedJob) {
      // Place the picked job
      setSelectedOpportunity(pickedJob);
      const startH = parseInt(time.substring(0, 2));
      const endTime = `${String(Math.min(startH + 8, 19)).padStart(2, '0')}:00`;
      setAssignPresets({ preselectedMember: memberId, preselectedDate: date, startTime: time, endTime });
      setAssignModalOpen(true);
      setPickedJob(null);
    }
  }

  // Called on double-click on empty slot — quick add (no SF job)
  function handleSlotDoubleClick(date, time, memberId) {
    if (pickedJob) {
      // If a job is picked, treat as slot click
      handleSlotClick(date, time, memberId);
      return;
    }
    setQuickAddPresets({ presetDate: date, presetTime: time, presetMemberId: memberId });
    setQuickAddOpen(true);
  }

  // Called when a job card is dropped onto a calendar cell (keep as fallback)
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

  // Called when an event block is clicked
  function handleEventClick(event) {
    // Don't open event detail if we have a picked job — place it instead
    if (pickedJob) return;
    setSelectedEvent(event);
    setEventDetailOpen(true);
  }

  function handleCloseEventDetail() {
    setEventDetailOpen(false);
    setSelectedEvent(null);
  }

  // Cancel picked job with Escape key
  function handleKeyDown(e) {
    if (e.key === 'Escape' && pickedJob) {
      setPickedJob(null);
    }
  }

  function renderView() {
    switch (activeView) {
      case 'monthly':
        return <MonthlyView navigate={navigate} currentDate={currentDate} onDropJob={handleDropJob} onEventClick={handleEventClick} {...viewParams} />;
      case 'weekly':
        return <WeeklyView navigate={navigate} currentDate={currentDate} onDateChange={setCurrentDate} onDropJob={handleDropJob} onEventClick={handleEventClick} onSlotClick={handleSlotClick} onSlotDoubleClick={handleSlotDoubleClick} {...viewParams} />;
      case 'daily':
        return <DailyView navigate={navigate} currentDate={currentDate} onDateChange={setCurrentDate} onDropJob={handleDropJob} onEventClick={handleEventClick} onSlotClick={handleSlotClick} onSlotDoubleClick={handleSlotDoubleClick} {...viewParams} />;
      case 'settings':
        return <SettingsView />;
      default:
        return <MonthlyView navigate={navigate} currentDate={currentDate} onEventClick={handleEventClick} {...viewParams} />;
    }
  }

  return (
    <AuthProvider>
      <CalendarProvider>
        <AppProvider>
          {/* Picked job banner */}
          {pickedJob && (
            <div
              className="fixed top-0 left-0 right-0 z-50 bg-orange-500 text-white text-center py-2 text-sm font-medium shadow-lg"
              onClick={() => setPickedJob(null)}
            >
              📌 「{pickedJob.name}」を選択中 — カレンダーのスロットをクリックして配置 （クリックでキャンセル / Escキー）
            </div>
          )}
          <div onKeyDown={handleKeyDown} tabIndex={-1} className={pickedJob ? 'pt-10' : ''}>
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
          />
        </AppProvider>
      </CalendarProvider>
    </AuthProvider>
  );
}
