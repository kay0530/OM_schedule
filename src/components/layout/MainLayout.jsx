import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import JobPanel from '../jobs/JobPanel';

export default function MainLayout({ activeView, onNavigate, currentDate, onDateChange, onSelectOpportunity, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [jobPanelOpen, setJobPanelOpen] = useState(true);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        activeView={activeView}
        onNavigate={onNavigate}
        onToggleSidebar={() => {
          if (sidebarCollapsed) {
            setSidebarCollapsed(false);
          } else {
            setSidebarOpen(!sidebarOpen);
          }
        }}
        currentDate={currentDate}
        onDateChange={onDateChange}
      />
      <Sidebar
        activeView={activeView}
        onNavigate={onNavigate}
        isOpen={sidebarOpen}
        collapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <main className={`pt-14 transition-all duration-200 ${
        sidebarCollapsed ? 'lg:pl-14' : 'lg:pl-60'
      } ${jobPanelOpen ? 'lg:pr-80' : 'pr-0'}`}>
        <div className="p-4 lg:p-6">
          {children}
        </div>
      </main>
      <JobPanel
        onSelectOpportunity={onSelectOpportunity}
        isOpen={jobPanelOpen}
        onToggle={() => setJobPanelOpen(!jobPanelOpen)}
      />
    </div>
  );
}
