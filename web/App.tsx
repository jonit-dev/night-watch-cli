import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import Dashboard from './pages/Dashboard';
import PRDs from './pages/PRDs';
import PRs from './pages/PRs';
import Board from './pages/Board';
import Scheduling from './pages/Scheduling';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import Roadmap from './pages/Roadmap';
import Agents from './pages/Agents';
import { ToastContainer } from './components/ui/Toast';
import { useGlobalMode } from './hooks/useGlobalMode';

const App: React.FC = () => {
  useGlobalMode();

  return (
    <Router>
      <div className="flex h-screen bg-[#030712] text-slate-300 overflow-hidden relative">
        {/* Subtle background glow effect */}
        <div className="absolute top-0 left-0 w-full h-96 bg-indigo-900/10 rounded-full blur-[120px] -translate-y-1/2 pointer-events-none z-0" />
        
        <Sidebar />
        
        <div className="flex-1 flex flex-col min-w-0 z-10">
          <TopBar />
          
          <main className="flex-1 overflow-auto p-6 scroll-smooth relative">
            <div className="max-w-7xl mx-auto w-full">
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/prds" element={<PRDs />} />
                <Route path="/prs" element={<PRs />} />
                <Route path="/board" element={<Board />} />
                <Route path="/scheduling" element={<Scheduling />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/roadmap" element={<Roadmap />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>
        
        <ToastContainer />
      </div>
    </Router>
  );
};

export default App;