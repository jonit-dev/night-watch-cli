import React from 'react';
import { Search, Bell, Settings, Wifi, WifiOff } from 'lucide-react';
import { PROJECTS } from '../constants';
import { useStore } from '../store/useStore';

const TopBar: React.FC = () => {
  const { currentProjectId } = useStore();
  const project = PROJECTS.find(p => p.id === currentProjectId) || PROJECTS[0];
  const isLive = true; // Mock connection status

  return (
    <header className="h-20 flex items-center justify-between px-8 z-40 sticky top-0 bg-[#030712]/80 backdrop-blur-md border-b border-white/5">
      <div className="flex items-center space-x-6">
        <div>
           <div className="text-xs font-mono text-indigo-400 mb-0.5 tracking-tight">Active Project</div>
           <h1 className="text-xl font-semibold text-white tracking-tight leading-none">{project.name}</h1>
        </div>
        
        <div className="h-8 w-px bg-white/10 mx-2"></div>
        
        <div className={`flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${isLive ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_-4px_rgba(16,185,129,0.3)]' : 'bg-red-500/5 text-red-400 border-red-500/20'}`}>
          {isLive ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          <span className="uppercase tracking-wider text-[10px]">{isLive ? 'Online' : 'Offline'}</span>
        </div>
      </div>

      <div className="flex items-center space-x-5">
        {/* Global Search */}
        <div className="relative hidden md:block group">
          <input
            type="text"
            placeholder="Search ( / )"
            className="w-72 pl-10 pr-4 py-2 rounded-lg border border-white/5 bg-white/5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all placeholder:text-slate-600 focus:bg-[#0b101b]"
          />
          <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors" />
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-3">
          <button className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-full relative transition-all">
            <Bell className="h-5 w-5" />
            <span className="absolute top-2.5 right-2.5 h-2 w-2 bg-red-500 rounded-full ring-2 ring-[#030712]"></span>
          </button>
          <button className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all">
            <Settings className="h-5 w-5" />
          </button>
        </div>
        
        <div className="h-9 w-9 rounded-full bg-gradient-to-tr from-indigo-600 to-purple-600 ring-2 ring-white/10 flex items-center justify-center text-white font-bold text-xs shadow-lg">
          AD
        </div>
      </div>
    </header>
  );
};

export default TopBar;