import React from 'react';
import { Navigate, Route, HashRouter as Router, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar.js';
import TopBar from './components/TopBar.js';
import CommandPalette from './components/CommandPalette.js';
import ActivityCenter from './components/ActivityCenter.js';
import { ToastContainer } from './components/ui/Toast.js';
import { useGlobalMode } from './hooks/useGlobalMode.js';
import { useStatusSync } from './hooks/useStatusSync.js';
import { useCommandPalette } from './hooks/useCommandPalette.js';
// import Agents from './pages/Agents';
import Board from './pages/Board.js';
import Dashboard from './pages/Dashboard.js';
import Logs from './pages/Logs.js';
import PRs from './pages/PRs.js';
import Roadmap from './pages/Roadmap.js';
import Scheduling from './pages/Scheduling.js';
import Settings from './pages/Settings.js';

const App: React.FC = () => {
  useGlobalMode();
  useStatusSync();
  useCommandPalette();

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
                <Route path="/prs" element={<PRs />} />
                <Route path="/board" element={<Board />} />
                <Route path="/scheduling" element={<Scheduling />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/roadmap" element={<Roadmap />} />
                {/* <Route path="/agents" element={<Agents />} /> */}
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </main>
        </div>

        <ToastContainer />
        <CommandPalette />
        <ActivityCenter />
      </div>
    </Router>
  );
};

export default App;
