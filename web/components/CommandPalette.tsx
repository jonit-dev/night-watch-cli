import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  Search,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore.js';
import {
  triggerJob,
  triggerInstallCron,
  triggerUninstallCron,
  useApi,
  fetchScheduleInfo,
} from '../api.js';
import { WEB_JOB_REGISTRY } from '../utils/jobs.js';

type AgentStatus = 'idle' | 'running' | 'unknown';

interface ICommand {
  id: string;
  label: string;
  category: 'navigate' | 'agents' | 'scheduling';
  shortcut?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  action: () => void;
}

const CommandPalette: React.FC = () => {
  const { commandPaletteOpen, setCommandPaletteOpen, addToast, status } = useStore();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch schedule info for scheduling commands
  const { data: scheduleInfo } = useApi(fetchScheduleInfo, [], { enabled: commandPaletteOpen });

  // Get agent running status from status
  const agentStatus: Record<string, AgentStatus> = useMemo(() => {
    const result: Record<string, AgentStatus> = {};
    if (!status?.processes) return result;

    status.processes.forEach((p) => {
      result[p.name] = p.running ? 'running' : 'idle';
    });

    // Mark any agent not in processes as idle (they might be stopped but we)
    WEB_JOB_REGISTRY.forEach((job) => {
      const processName = job.processName;
      if (!result[processName]) {
        result[processName] = 'idle';
      }
    });

    return result;
  }, [status?.processes]);

  // Build commands
  const commands = useMemo((): ICommand[] => {
    const result: ICommand[] = [];
    const agentStatusMap = agentStatus;

    // Navigation commands
    result.push(
      { id: 'dashboard', label: 'Dashboard', category: 'navigate', shortcut: 'Cmd+1', icon: <ChevronRight className="h-4 w-4" />, action: () => navigate('/') },
      { id: 'logs', label: 'Logs', category: 'navigate', shortcut: 'Cmd+2', icon: <ChevronRight className="h-4 w-4" />, action: () => navigate('/logs') },
      { id: 'board', label: 'Board', category: 'navigate', shortcut: 'Cmd+3', icon: <ChevronRight className="h-4 w-4" />, action: () => navigate('/board') },
      { id: 'scheduling', label: 'Scheduling', category: 'navigate', shortcut: 'Cmd+4', icon: <ChevronRight className="h-4 w-4" />, action: () => navigate('/scheduling') },
      { id: 'settings', label: 'Settings', category: 'navigate', shortcut: 'Cmd+,', icon: <ChevronRight className="h-4 w-4" />, action: () => navigate('/settings') }
    );

    // Agent commands
    WEB_JOB_REGISTRY.forEach((job) => {
      const status = agentStatusMap[job.processName] ?? 'unknown';
      const canRun = status === 'idle';

      if (canRun) {
        result.push({
          id: `run-${job.id}`,
          label: `Run ${job.label}`,
          category: 'agents',
          icon: <Play className="h-4 w-4" />,
          action: async () => {
            try {
              await triggerJob(job.id);
              addToast({ title: 'Job Triggered', message: `${job.label} has been queued.`, type: 'success' });
            } catch {
              addToast({ title: 'Trigger Failed', message: `Failed to trigger ${job.label}`, type: 'error' });
            }
          },
        });
      }
    });

    // Scheduling commands
    const isPaused = scheduleInfo?.paused ?? false;
    result.push({
      id: 'pause-automation',
      label: 'Pause Automation',
      category: 'scheduling',
      icon: <Pause className="h-4 w-4" />,
      disabled: isPaused,
      action: async () => {
        try {
          await triggerUninstallCron();
          addToast({ title: 'Automation Paused', message: 'Cron schedules have been deactivated.', type: 'info' });
        } catch {
          addToast({ title: 'Action Failed', message: 'Failed to pause automation', type: 'error' });
        }
      },
    });

    result.push({
      id: 'resume-automation',
      label: 'Resume Automation',
      category: 'scheduling',
      icon: <Play className="h-4 w-4" />,
      disabled: !isPaused,
      action: async () => {
        try {
          await triggerInstallCron();
          addToast({ title: 'Automation Resumed', message: 'Cron schedules have been reactivated.', type: 'success' });
        } catch {
          addToast({ title: 'Action Failed', message: 'Failed to resume automation', type: 'error' });
        }
      },
    });

    return result;
  }, [status?.processes, scheduleInfo?.paused, addToast, navigate, agentStatus]);

  // Filter commands by search term
  const filteredCommands = useMemo(() => {
    if (!searchTerm.trim()) {
      return commands;
    }

    const lowerSearch = searchTerm.toLowerCase();
    return commands.filter((cmd) => {
      const matchesLabel = cmd.label.toLowerCase().includes(lowerSearch);
      const matchesCategory = cmd.category.toLowerCase().includes(lowerSearch);
      return matchesLabel || matchesCategory;
    });
  }, [commands, searchTerm]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups: Record<string, ICommand[]> = {
      navigate: [],
      agents: [],
      scheduling: [],
    };

    filteredCommands.forEach((cmd) => {
      if (groups[cmd.category]) {
        groups[cmd.category].push(cmd);
      }
    });

    return groups;
  }, [filteredCommands]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!commandPaletteOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
        e.preventDefault();
        filteredCommands[selectedIndex].action();
        setCommandPaletteOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [commandPaletteOpen, filteredCommands, selectedIndex, setCommandPaletteOpen]);

  // Focus input when palette opens
  useEffect(() => {
    if (commandPaletteOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [commandPaletteOpen]);

  // Reset selected index when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  if (!commandPaletteOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200]"
      data-command-palette
      onClick={() => setCommandPaletteOpen(false)}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-[560px] bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-3 px-4">
            <Search className="h-5 w-5 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search commands or navigate..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1 bg-transparent text-slate-200 placeholder-slate-500 text-sm outline-none"
            />
          </div>
        </div>

        {/* Commands List */}
        <div className="max-h-[400px] overflow-y-auto p-2">
          {Object.entries(groupedCommands).map(([category, cmds]) => (
            <div key={category}>
              {/* Category Header */}
              <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {category}
              </div>

              {/* Commands */}
              {cmds.map((cmd, index) => {
                const globalIndex = filteredCommands.indexOf(cmd);
                const isSelected = globalIndex === selectedIndex;

                return (
                  <button
                    key={cmd.id}
                    className={`
                      w-full flex items-center gap-3 px-4 py-2.5 text-left rounded-lg transition-colors
                      ${isSelected ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-300 hover:bg-slate-800/50'}
                      ${cmd.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                    onClick={() => {
                      if (!cmd.disabled) {
                        cmd.action();
                        setCommandPaletteOpen(false);
                      }
                    }}
                    disabled={cmd.disabled}
                  >
                    {/* Icon */}
                    <div className={`${isSelected ? 'text-indigo-400' : 'text-slate-400'}`}>
                      {cmd.icon || <ChevronRight className="h-4 w-4" />}
                    </div>

                    {/* Label */}
                    <span className="flex-1 text-sm font-medium">{cmd.label}</span>

                    {/* Shortcut */}
                    {cmd.shortcut && (
                      <span className={`text-xs font-mono ${isSelected ? 'text-indigo-300' : 'text-slate-500'}`}>
                        {cmd.shortcut}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Empty State */}
          {filteredCommands.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              No commands found for "{searchTerm}"
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-800 text-xs text-slate-500 text-center">
          <span className="text-slate-400">ESC</span> to close
          <span className="mx-2">|</span>
          <span className="text-slate-400">↑↓</span> to navigate
          <span className="mx-2">|</span>
          <span className="text-slate-400">Enter</span> to select
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
