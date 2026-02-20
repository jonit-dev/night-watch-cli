import {
  Blocks,
  Briefcase,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  GitPullRequest,
  Home,
  Kanban,
  Map,
  Settings,
  Terminal,
  Users,
} from 'lucide-react';
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useStore } from '../store/useStore';

const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { projectName, isGlobalMode, projects, selectedProjectId, selectProject } = useStore();

  const navItems = [
    { icon: Home, label: 'Dashboard', path: '/' },
    { icon: Kanban, label: 'Board', path: '/board' },
    { icon: GitPullRequest, label: 'Pull Requests', path: '/prs', badge: 1 },
    { icon: Map, label: 'Roadmap', path: '/roadmap' },
    { icon: Calendar, label: 'Scheduling', path: '/scheduling' },
    { icon: Terminal, label: 'Logs', path: '/logs' },
    { icon: Blocks, label: 'Integrations', path: '/integrations' },
    { icon: Users, label: 'Agents', path: '/agents' },
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
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3 block pl-1">
              {isGlobalMode ? 'Projects' : 'Workspace'}
            </label>
            {isGlobalMode ? (
              <div className="relative">
                <Briefcase className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-indigo-400 pointer-events-none" />
                <select
                  value={selectedProjectId || ''}
                  onChange={(e) => selectProject(e.target.value)}
                  className="w-full bg-[#111827] border border-white/10 text-slate-200 rounded-lg py-3 pl-10 pr-8 text-sm font-medium shadow-sm appearance-none cursor-pointer hover:border-white/20 transition-colors focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20"
                >
                  {projects.filter((p) => p.valid).map((p) => (
                    <option key={p.name} value={p.name}>{p.name}</option>
                  ))}
                </select>
                <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500 pointer-events-none" />
              </div>
            ) : (
              <div className="w-full bg-[#111827] border border-white/10 text-slate-200 rounded-lg py-3 px-3.5 text-sm font-medium shadow-sm flex items-center">
                <Briefcase className="h-4 w-4 text-indigo-400 mr-3" />
                <span className="truncate">{projectName}</span>
              </div>
            )}
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
            <React.Fragment key={item.path}>
              {item.path === '/agents' && !collapsed && (
                <li className="pt-3 pb-1 px-3.5">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Team</span>
                </li>
              )}
              <li>
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
            </React.Fragment>
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
