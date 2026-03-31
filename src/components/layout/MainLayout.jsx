import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import JobPanel from '../jobs/JobPanel';

export default function MainLayout({ activeView, onNavigate, currentDate, onDateChange, onSelectOpportunity, children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        activeView={activeView}
        onNavigate={onNavigate}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        currentDate={currentDate}
        onDateChange={onDateChange}
      />
      <Sidebar
        activeView={activeView}
        onNavigate={onNavigate}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="pt-14 lg:pl-60 pr-0 lg:pr-80">
        <div className="p-4 lg:p-6">
          {children}
        </div>
      </main>
      <JobPanel onSelectOpportunity={onSelectOpportunity} />
    </div>
  );
}
