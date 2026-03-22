import React, { useEffect, useRef } from 'react';
import { X, CheckCircle, AlertCircle, Pause, Play, GitPullRequest, Clock } from 'lucide-react';
import { useStore } from '../store/useStore.js';
import { useActivityFeed } from '../hooks/useActivityFeed.js';
import type { IActivityEvent } from '../hooks/useActivityFeed';

function getEventIcon(type: IActivityEvent['type']): React.ReactNode {
  switch (type) {
    case 'agent_completed':
      return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    case 'agent_failed':
      return <AlertCircle className="h-4 w-4 text-red-400" />;
    case 'automation_paused':
      return <Pause className="h-4 w-4 text-amber-400" />;
    case 'automation_resumed':
      return <Play className="h-4 w-4 text-emerald-400" />;
    case 'pr_opened':
      return <GitPullRequest className="h-4 w-4 text-indigo-400" />;
    case 'schedule_fired':
      return <Clock className="h-4 w-4 text-slate-400" />;
    default:
      return <CheckCircle className="h-4 w-4 text-slate-400" />;
  }
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 1) return `${diffSeconds}s ago`;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getEventDescription(event: IActivityEvent): string {
  switch (event.type) {
    case 'agent_completed':
      return `${event.agent} completed${event.prd ? ` PRD-${event.prd}` : ''}${event.duration ? ` (${event.duration})` : ''}`;
    case 'agent_failed':
      return `${event.agent} failed${event.error ? `: ${event.error.substring(0, 50)}` : ''}`;
    case 'automation_paused':
      return 'Automation paused';
    case 'automation_resumed':
      return 'Automation resumed';
    case 'pr_opened':
      return `PR #${event.prNumber} opened${event.prTitle ? `: ${event.prTitle.substring(0, 40)}${event.prTitle.length > 40 ? '...' : ''}` : ''}`;
    case 'schedule_fired':
      return `${event.agent} scheduled run triggered`;
    default:
      return 'Unknown event';
  }
}

const ActivityCenter: React.FC = () => {
  const { activityCenterOpen, setActivityCenterOpen } = useStore();
  const { groupedEvents, hasUnread, markAsRead } = useActivityFeed();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activityCenterOpen) {
      markAsRead();
    }
  }, [activityCenterOpen, markAsRead]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        activityCenterOpen
      ) {
        setActivityCenterOpen(false);
      }
    };

    if (activityCenterOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activityCenterOpen, setActivityCenterOpen]);

  const handleClose = () => {
    setActivityCenterOpen(false);
  };

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={`fixed inset-0 bg-black/50 transition-opacity duration-300 z-40 ${
          activityCenterOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={handleClose}
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        className={`fixed right-0 top-0 h-full w-[360px] bg-slate-900 border-l border-slate-800 shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
          activityCenterOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800">
          <h2 className="text-lg font-semibold text-white">Activity</h2>
          <button
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {groupedEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <Clock className="h-8 w-8 mb-2" />
              <p className="text-sm">No recent activity</p>
              <p className="text-xs text-slate-600 mt-1">Events will appear here as they occur</p>
            </div>
          ) : (
            <div className="p-2">
              {groupedEvents.map((group) => (
                <div key={group.label} className="mb-4">
                  {/* Day header */}
                  <div className="px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {group.label}
                  </div>

                  {/* Events */}
                  <div className="space-y-1">
                    {group.events.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/50 transition-colors"
                      >
                        {/* Icon */}
                        <div className="flex-shrink-0 mt-0.5">
                          {getEventIcon(event.type)}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-200 leading-snug">
                            {getEventDescription(event)}
                          </p>
                        </div>

                        {/* Time */}
                        <div className="flex-shrink-0">
                          <span className="text-xs text-slate-500">
                            {formatRelativeTime(event.ts)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-500">
          <p>Showing {groupedEvents.reduce((acc, g) => acc + g.events.length, 0)} events</p>
        </div>
      </div>
    </>
  );
};

export default ActivityCenter;
