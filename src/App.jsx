import { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { CalendarProvider } from './context/CalendarContext';
import { AppProvider } from './context/AppContext';
import MainLayout from './components/layout/MainLayout';
import MonthlyView from './components/schedule/MonthlyView';
import WeeklyView from './components/schedule/WeeklyView';
import SettingsView from './components/settings/SettingsView';
import AssignModal from './components/schedule/AssignModal';
import EventDetailModal from './components/schedule/EventDetailModal';
import QuickAddModal from './components/schedule/QuickAddModal';

export default function App() {
  const [activeView, setActiveView] = useState('monthly');
  const [viewParams, setViewParams] = useState({});
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignPresets, setAssignPresets] = useState({});

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

  // Called when an opportunity is selected from the JobPanel
  function handleSelectOpportunity(opportunity) {
    setSelectedOpportunity(opportunity);
    setAssignModalOpen(true);
  }

  function handleCloseModal() {
    setAssignModalOpen(false);
    setSelectedOpportunity(null);
    setAssignPresets({});
  }

  // Called when a job card is dropped onto a calendar cell
  function handleDropJob(jobData, date, memberId, startTime, endTime) {
    setSelectedOpportunity(jobData);
    setAssignPresets({ preselectedMember: memberId, preselectedDate: date, startTime, endTime });
    setAssignModalOpen(true);
  }

  // Called when an event block is clicked in WeeklyView or MonthlyView
  function handleEventClick(event) {
    setSelectedEvent(event);
    setEventDetailOpen(true);
  }

  function handleCloseEventDetail() {
    setEventDetailOpen(false);
    setSelectedEvent(null);
  }

  // Called on double-click on empty slot in WeeklyView
  function handleSlotDoubleClick(date, time, memberId) {
    setQuickAddPresets({ presetDate: date, presetTime: time, presetMemberId: memberId });
    setQuickAddOpen(true);
  }

  function renderView() {
    switch (activeView) {
      case 'monthly':
        return <MonthlyView navigate={navigate} currentDate={currentDate} onDropJob={handleDropJob} onEventClick={handleEventClick} {...viewParams} />;
      case 'weekly':
        return <WeeklyView navigate={navigate} currentDate={currentDate} onDateChange={setCurrentDate} onDropJob={handleDropJob} onEventClick={handleEventClick} onSlotDoubleClick={handleSlotDoubleClick} {...viewParams} />;
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
          <MainLayout
            activeView={activeView}
            onNavigate={navigate}
            currentDate={currentDate}
            onDateChange={setCurrentDate}
            onSelectOpportunity={handleSelectOpportunity}
          >
            {renderView()}
          </MainLayout>
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
