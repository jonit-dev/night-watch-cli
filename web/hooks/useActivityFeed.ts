import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../store/useStore.js';
import { fetchLogs } from '../api.js';
import { WEB_JOB_REGISTRY } from '../utils/jobs.js';
import type { IStatusSnapshot } from '@shared/types';

export interface IActivityEvent {
  id: string;
  type: 'agent_completed' | 'agent_failed' | 'schedule_fired' | 'automation_paused' | 'automation_resumed' | 'pr_opened';
  agent?: string;
  duration?: string;
  prd?: string;
  error?: string;
  prNumber?: number;
  prTitle?: string;
  ts: Date;
}

interface IDayGroup {
  label: string;
  events: IActivityEvent[];
}

const MAX_EVENTS = 50;
const LOG_LINES_TO_FETCH = 200;

function generateEventId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

function formatDuration(startTime: number): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

function getDayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();

  if (isToday) return 'Today';
  if (isYesterday) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function parseLogEntryForEvent(logLine: string, agentName: string): IActivityEvent | null {
  const tsMatch = logLine.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
  const timestamp = tsMatch ? new Date(tsMatch[1]) : new Date();

  if (logLine.includes('[ERROR]') || logLine.includes('error') || logLine.includes('failed') || logLine.includes('Failed')) {
    const errorMatch = logLine.match(/(?:error|failed|Error|Failed)[:\s]*(.+)/i);
    return {
      id: generateEventId(),
      type: 'agent_failed',
      agent: agentName,
      error: errorMatch?.[1]?.substring(0, 100) || 'Unknown error',
      ts: timestamp,
    };
  }

  if (logLine.includes('completed') || logLine.includes('Completed') || logLine.includes('finished') || logLine.includes('Finished')) {
    const prdMatch = logLine.match(/PRD[-\s]*(\w+)/i);
    const durationMatch = logLine.match(/(?:duration|took)[:\s]*(\d+[hms]+)/i);
    return {
      id: generateEventId(),
      type: 'agent_completed',
      agent: agentName,
      duration: durationMatch?.[1],
      prd: prdMatch?.[1],
      ts: timestamp,
    };
  }

  return null;
}

export function useActivityFeed(): {
  events: IActivityEvent[];
  groupedEvents: IDayGroup[];
  hasUnread: boolean;
  markAsRead: () => void;
} {
  const status = useStore((s) => s.status);
  const activityCenterOpen = useStore((s) => s.activityCenterOpen);
  const [events, setEvents] = useState<IActivityEvent[]>([]);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<Date>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('nw-activity-last-read') : null;
    return saved ? new Date(saved) : new Date(0);
  });
  const previousStatusRef = useRef<IStatusSnapshot | null>(null);
  const runningStartTimesRef = useRef<Map<string, number>>(new Map());

  const markAsRead = useCallback(() => {
    const now = new Date();
    setLastReadTimestamp(now);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('nw-activity-last-read', now.toISOString());
    }
  }, []);

  const hasUnread = !activityCenterOpen && events.some((e) => e.ts > lastReadTimestamp);

  useEffect(() => {
    if (previousStatusRef.current && status) {
      const prevStatus = previousStatusRef.current;
      const newEvents: IActivityEvent[] = [];

      status.processes.forEach((currentProcess) => {
        const prevProcess = prevStatus.processes.find((p) => p.name === currentProcess.name);
        const jobDef = WEB_JOB_REGISTRY.find((j) => j.processName === currentProcess.name);
        const agentLabel = jobDef?.label || currentProcess.name;

        if (prevProcess?.running && !currentProcess.running) {
          const startTime = runningStartTimesRef.current.get(currentProcess.name);
          const duration = startTime ? formatDuration(startTime) : undefined;

          newEvents.push({
            id: generateEventId(),
            type: 'agent_completed',
            agent: agentLabel,
            duration,
            ts: new Date(),
          });
          runningStartTimesRef.current.delete(currentProcess.name);
        }

        if (!prevProcess?.running && currentProcess.running) {
          runningStartTimesRef.current.set(currentProcess.name, Date.now());
        }
      });

      const wasPaused = prevStatus.crontab?.installed;
      const isPaused = status.crontab?.installed;
      if (wasPaused && !isPaused) {
        newEvents.push({
          id: generateEventId(),
          type: 'automation_resumed',
          ts: new Date(),
        });
      } else if (!wasPaused && isPaused) {
        newEvents.push({
          id: generateEventId(),
          type: 'automation_paused',
          ts: new Date(),
        });
      }

      const prevPrNumbers = new Set(prevStatus.prs.map((pr) => pr.number));
      status.prs.forEach((pr) => {
        if (!prevPrNumbers.has(pr.number) && pr.ciStatus !== 'unknown') {
          newEvents.push({
            id: generateEventId(),
            type: 'pr_opened',
            prNumber: pr.number,
            prTitle: pr.title,
            ts: new Date(),
          });
        }
      });

      if (newEvents.length > 0) {
        setEvents((prev) => [...newEvents, ...prev].slice(0, MAX_EVENTS));
      }
    }

    previousStatusRef.current = status;
  }, [status]);

  useEffect(() => {
    const fetchInitialEvents = async () => {
      const initialEvents: IActivityEvent[] = [];

      try {
        const logPromises = WEB_JOB_REGISTRY.slice(0, 5).map(async (job) => {
          try {
            const response = await fetchLogs(job.processName, LOG_LINES_TO_FETCH);
            const lines = response?.lines || [];
            const recentLines = lines.slice(-20);
            recentLines.forEach((line) => {
              const event = parseLogEntryForEvent(line, job.label);
              if (event) {
                initialEvents.push(event);
              }
            });
          } catch {
            // Silently ignore log fetch errors during initial load
          }
        });

        await Promise.all(logPromises);

        const uniqueEvents = initialEvents
          .filter((event, index, self) =>
            index === self.findIndex((e) =>
              e.ts.getTime() === event.ts.getTime() && e.type === event.type
            )
          )
          .sort((a, b) => b.ts.getTime() - a.ts.getTime())
          .slice(0, MAX_EVENTS);

        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEvents = uniqueEvents.filter((e) => !existingIds.has(e.id));
          return [...newEvents, ...prev].slice(0, MAX_EVENTS);
        });
      } catch {
        // Silently ignore initial fetch errors
      }
    };

    fetchInitialEvents();
  }, []);

  const groupedEvents: IDayGroup[] = [];
  const grouped = new Map<string, IActivityEvent[]>();

  events.forEach((event) => {
    const label = getDayLabel(event.ts);
    if (!grouped.has(label)) {
      grouped.set(label, []);
    }
    grouped.get(label)!.push(event);
  });

  grouped.forEach((groupEvents, label) => {
    groupedEvents.push({ label, events: groupEvents });
  });

  return { events, groupedEvents, hasUnread, markAsRead };
}
