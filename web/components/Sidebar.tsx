import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { 
  Home, 
  FileText, 
  GitPullRequest, 
  PlayCircle, 
  Terminal, 
  Settings, 
  ChevronLeft, 
  ChevronRight,
  Briefcase
} from 'lucide-react';
import { PROJECTS } from '../constants';
import { useStore } from '../store/useStore';

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { currentProjectId, setCurrentProjectId } = useStore();

  const navItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: FileText, label: 'PRDs', path: '/prds', badge: 3 },
    { icon: GitPullRequest, label: 'Pull Requests', path: '/prs', badge: 1 },
    { icon: PlayCircle, label: 'Actions', path: '/actions' },
    { icon: Terminal, label: 'Logs', path: '/logs' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <aside 
      className={`
        relative flex flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]
        ${collapsed ? 'w-20' : 'w-72'} h-screen flex-shrink-0 z-50
        bg-[#030712]/80 backdrop-blur-xl border-r border-white/5
      `}
    >
      {/* Project Selector */}
      <div className={`p-6 border-b border-white/5 ${collapsed ? 'items-center justify-center flex' : ''}`}>
        {!collapsed ? (
          <div className="relative w-full">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 block pl-1">Workspace</label>
            <div className="relative group">
              <select 
                value={currentProjectId}
                onChange={(e) => setCurrentProjectId(e.target.value)}
                className="w-full appearance-none bg-[#111827] border border-white/10 text-slate-200 rounded-lg py-3 pl-10 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all text-sm font-medium hover:border-white/20 cursor-pointer shadow-sm"
              >
                {PROJECTS.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-indigo-400">
                <Briefcase className="h-4 w-4" />
              </div>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                <svg className="h-4 w-4 fill-current opacity-50" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </div>
            </div>
          </div>
        ) : (
           <div className="relative group">
              <div className="h-10 w-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold cursor-pointer shadow-lg shadow-indigo-500/20 group-hover:bg-indigo-500 transition-colors bg-gradient-to-br from-indigo-500 to-indigo-700" title="Switch Project">
                NW
              </div>
           </div>
        )}
      </div>

      {/* Nav Items */}
      <nav className="flex-1 py-6 overflow-y-auto overflow-x-hidden scrollbar-hide">
        <ul className="space-y-1.5 px-4">
          {navItems.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                className={({ isActive }) => `
                  flex items-center px-3.5 py-3 rounded-xl transition-all duration-200 group relative
                  ${isActive 
                    ? 'bg-indigo-500/10 text-indigo-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]' 
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}
                  ${collapsed ? 'justify-center' : ''}
                `}
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={`h-5 w-5 transition-colors ${isActive ? 'text-indigo-400 drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]' : 'text-slate-500 group-hover:text-slate-300'} ${collapsed ? '' : 'mr-3.5'}`} />
                    {!collapsed && (
                      <span className="flex-1 text-sm font-medium tracking-wide">{item.label}</span>
                    )}
                    
                    {/* Badge */}
                    {item.badge && (
                      collapsed ? (
                        <span className="absolute top-2 right-2 h-2 w-2 bg-indigo-500 rounded-full border border-[#030712] shadow-sm"></span>
                      ) : (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${isActive ? 'bg-indigo-500/20 text-indigo-300' : 'bg-white/5 text-slate-400 border border-white/5'}`}>
                          {item.badge}
                        </span>
                      )
                    )}

                    {/* Active Indicator Bar */}
                    {isActive && !collapsed && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-r-full shadow-[0_0_10px_rgba(99,102,241,0.4)]"></div>
                    )}

                    {/* Tooltip on collapse */}
                    {collapsed && (
                      <div className="absolute left-full ml-4 px-3 py-1.5 bg-[#111827] text-white text-xs font-medium rounded-md border border-white/10 shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 transition-opacity translate-x-2 group-hover:translate-x-0">
                        {item.label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Collapse Toggle */}
      <div className="p-4 border-t border-white/5 flex justify-end">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors"
        >
          {collapsed ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />}
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;