/**
 * API Client for Night Watch Web UI
 * Fetches real data from the CLI's HTTP API server
 * Supports both single-project and global (multi-project) modes
 */

import type {
    ClaudeModel,
    DayOfWeek,
    IAnalyticsConfig,
    IAuditConfig,
    IBoardProviderConfig,
    IJobProviders,
    ILogInfo,
    IMergerConfig,
    INightWatchConfig,
    INotificationConfig,
    IPrdInfo,
    IProviderBucketConfig,
    IProviderPreset,
    IProviderScheduleOverride,
    IPrInfo,
    IProcessInfo,
    IQaConfig,
    IQueueConfig,
    IRoadmapItem,
    IRoadmapScannerConfig,
    IRoadmapStatus,
    IStatusSnapshot,
    IWebhookConfig,
    JobType,
    MergeMethod,
    QaArtifacts,
    QueueMode,
} from '@shared/types';
import { DependencyList, useEffect, useRef, useState } from 'react';
import { getWebJobDef } from './utils/jobs';

// Re-export shared types so consumers can import from either place
export type {
    ClaudeModel, DayOfWeek, IAnalyticsConfig, IAuditConfig, IBoardProviderConfig, IJobProviders, ILogInfo, IMergerConfig, INightWatchConfig,
    INotificationConfig, IPrdInfo, IProviderBucketConfig, IProviderPreset, IProviderScheduleOverride, IPrInfo, IProcessInfo, IQaConfig,
    IQueueConfig, IRoadmapItem, IRoadmapScannerConfig, IRoadmapStatus, IStatusSnapshot, IWebhookConfig,
    JobType, MergeMethod, QaArtifacts, QueueMode
};

export type PrdWithContent = IPrdInfo & { content: string };

/**
 * Base URL for API requests
 * Empty string for same-origin requests (production)
 * Vite proxy will handle /api paths during development
 */
export const API_BASE = '';

// ==================== Global Mode Project Scoping ====================

let globalMode = false;
let currentProjectId: string | null = null;

export function setGlobalMode(v: boolean): void {
  globalMode = v;
}

export function setCurrentProject(id: string | null): void {
  currentProjectId = id;
}

export function getCurrentProject(): string | null {
  return currentProjectId;
}

export function isGlobalMode(): boolean {
  return globalMode;
}

/**
 * Encode a project ID for use in URL path segments.
 * Replaces '/' with '~' before percent-encoding to avoid Express 5
 * treating %2F as a path separator during route matching.
 */
function encodeProjectId(id: string): string {
  return encodeURIComponent(id.replace(/\//g, '~'));
}

/**
 * Build API path with optional project scoping.
 * In global mode: /api/status → /api/projects/{id}/status
 * In single-project mode: returns path unchanged.
 */
function apiPath(basePath: string): string {
  if (globalMode && currentProjectId) {
    return basePath.replace('/api/', `/api/projects/${encodeProjectId(currentProjectId)}/`);
  }
  return basePath;
}

// ==================== Project List (global mode only) ====================

export interface ProjectInfo {
  name: string;
  path: string;
  valid: boolean;
}

export interface ServerModeInfo {
  globalMode: boolean;
}

export function fetchServerMode(): Promise<ServerModeInfo> {
  return apiFetch<ServerModeInfo>('/api/mode');
}

export function fetchProjects(): Promise<ProjectInfo[]> {
  return apiFetch<ProjectInfo[]>('/api/projects');
}

export interface IRemoveProjectResult {
  cronEntriesRemoved: number;
  unregistered: boolean;
  dataPruned: boolean;
}

export function removeProject(projectId: string): Promise<IRemoveProjectResult> {
  const encoded = encodeProjectId(projectId);
  return apiFetch<IRemoveProjectResult>(`/api/projects/${encoded}`, {
    method: 'DELETE',
  });
}

// ==================== Generic Fetch ====================

/**
 * Generic API fetch wrapper with error handling
 */
async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

// ==================== Status Snapshot ====================
// StatusSnapshot, NightWatchConfig, NotificationConfig, WebhookConfig,
// PrdInfo, ProcessInfo, PrInfo, and LogInfo are imported from @night-watch/types above.

// ==================== Log Response ====================

export interface LogResponse {
  name: string;
  lines: string[];
}

// ==================== Doctor Check ====================

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

// ==================== Schedule Info ====================

export interface IScheduleInfo {
  executor: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  reviewer: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  qa?: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  audit?: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  planner?: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  analytics?: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  merger?: {
    schedule: string;
    installed: boolean;
    nextRun: string | null;
    delayMinutes: number;
    manualDelayMinutes: number;
    balancedDelayMinutes: number;
  };
  paused: boolean;
  schedulingPriority: number;
  entries: string[];
}

// ==================== Action Result ====================

export interface ActionResult {
  started: boolean;
  pid?: number;
  error?: string;
}

// ==================== API Functions ====================

export function fetchStatus(): Promise<IStatusSnapshot> {
  return apiFetch<IStatusSnapshot>(apiPath('/api/status'));
}

export function fetchPrs(): Promise<IPrInfo[]> {
  return apiFetch<IPrInfo[]>(apiPath('/api/prs'));
}

export function fetchLogs(name: string, lines?: number): Promise<LogResponse> {
  const query = lines !== undefined ? `?lines=${encodeURIComponent(lines)}` : '';
  return apiFetch<LogResponse>(apiPath(`/api/logs/${encodeURIComponent(name)}${query}`));
}

export function fetchConfig(): Promise<INightWatchConfig> {
  return apiFetch<INightWatchConfig>(apiPath('/api/config'));
}

export async function fetchAllConfigs(): Promise<Array<{ projectId: string; config: INightWatchConfig }>> {
  if (isGlobalMode()) {
    const projects = await fetchProjects();
    const validProjects = projects.filter(p => p.valid);
    
    const configs = await Promise.all(
      validProjects.map(async (p) => {
        try {
          const res = await apiFetch<INightWatchConfig>(`/api/projects/${encodeProjectId(p.name)}/config`);
          return { projectId: p.name, config: res };
        } catch (e) {
          console.error(`Failed to fetch config for project ${p.name}`, e);
          return null;
        }
      })
    );
    return configs.filter(c => c !== null) as Array<{ projectId: string; config: INightWatchConfig }>;
  } else {
    const config = await fetchConfig();
    return [{ projectId: currentProjectId || 'current', config }];
  }
}

export type ConfigUpdatePayload = Partial<Omit<INightWatchConfig, 'jobProviders'>> & {
  jobProviders?: Partial<Record<keyof IJobProviders, string | null>>;
};

export function updateConfig(changes: ConfigUpdatePayload): Promise<INightWatchConfig> {
  return apiFetch<INightWatchConfig>(apiPath('/api/config'), {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

export function fetchDoctor(): Promise<DoctorCheck[]> {
  return apiFetch<DoctorCheck[]>(apiPath('/api/doctor'));
}

export function fetchScheduleInfo(): Promise<IScheduleInfo> {
  return apiFetch<IScheduleInfo>(apiPath('/api/schedule-info'));
}

export function triggerRun(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/run'), {
    method: 'POST',
  });
}

export function triggerReview(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/review'), {
    method: 'POST',
  });
}

export function triggerQa(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/qa'), {
    method: 'POST',
  });
}

export function triggerAudit(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/audit'), {
    method: 'POST',
  });
}

export function triggerAnalytics(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/analytics'), {
    method: 'POST',
  });
}

export function triggerPlanner(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/planner'), {
    method: 'POST',
  });
}

export function triggerMerger(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/merge'), {
    method: 'POST',
  });
}

/**
 * Generic job trigger using the web job registry.
 * Prefer this over per-job triggerRun/triggerReview/etc. for new code.
 */
export function triggerJob(jobId: string): Promise<ActionResult> {
  const jobDef = getWebJobDef(jobId);
  if (!jobDef) {
    return Promise.reject(new Error(`Unknown job ID: ${jobId}`));
  }
  return apiFetch<ActionResult>(apiPath(jobDef.triggerEndpoint), { method: 'POST' });
}

export function triggerInstallCron(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/install-cron'), {
    method: 'POST',
  });
}

export function triggerUninstallCron(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/uninstall-cron'), {
    method: 'POST',
  });
}

export interface CancelResultItem {
  success: boolean;
  message: string;
  cleanedUp?: boolean;
}

export interface CancelActionResult {
  results: CancelResultItem[];
}

export function triggerCancel(type: 'run' | 'review' | 'all' = 'all'): Promise<CancelActionResult> {
  return apiFetch<CancelActionResult>(apiPath('/api/actions/cancel'), {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

// ==================== Board ====================

export type BoardColumnName = 'Draft' | 'Ready' | 'In Progress' | 'Review' | 'Done';

export const BOARD_COLUMNS: BoardColumnName[] = [
  'Draft', 'Ready', 'In Progress', 'Review', 'Done',
];

export interface IBoardIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  column: BoardColumnName | null;
  labels: string[];
  assignees: string[];
}

export interface IBoardStatus {
  enabled: boolean;
  columns: Record<BoardColumnName, IBoardIssue[]>;
}

export function fetchBoardStatus(): Promise<IBoardStatus> {
  return apiFetch<IBoardStatus>(apiPath('/api/board/status'));
}

export function createBoardIssue(input: {
  title: string;
  body: string;
  column?: BoardColumnName;
  labels?: string[];
}): Promise<IBoardIssue> {
  return apiFetch<IBoardIssue>(apiPath('/api/board/issues'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function moveBoardIssue(number: number, column: BoardColumnName): Promise<{ moved: boolean }> {
  return apiFetch<{ moved: boolean }>(apiPath(`/api/board/issues/${number}/move`), {
    method: 'PATCH',
    body: JSON.stringify({ column }),
  });
}

export async function closeBoardIssue(number: number): Promise<void> {
  const url = `${API_BASE}${apiPath(`/api/board/issues/${number}`)}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    method: 'DELETE',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }
}

// ==================== Actions ====================

export function triggerClearLock(): Promise<{ cleared: boolean }> {
  return apiFetch<{ cleared: boolean }>(apiPath('/api/actions/clear-lock'), { method: 'POST' });
}

// ==================== SSE Stream ====================

export function useStatusStream(
  onSnapshot: (snapshot: IStatusSnapshot) => void,
  deps: DependencyList = [],
  options?: { enabled?: boolean },
): void {
  const enabled = options?.enabled ?? true;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  useEffect(() => {
    if (!enabled) return;

    const url = `${API_BASE}${apiPath('/api/status/events')}`;
    const es = new EventSource(url);

    es.addEventListener('status_changed', (e) => {
      try {
        const snapshot = JSON.parse((e as MessageEvent).data) as IStatusSnapshot;
        onSnapshotRef.current(snapshot);
      } catch {
        // ignore parse errors
      }
    });

    return () => {
      es.close();
    };
    // deps intentionally excludes onChange - we don't want to re-subscribe on every render
  }, [enabled, ...deps]);
}

// ==================== Queue Status ====================

export interface IQueueStatusEntry {
  id: number;
  projectPath: string;
  projectName: string;
  jobType: string;
  priority: number;
  status: string;
  enqueuedAt: number;
  dispatchedAt: number | null;
  providerKey?: string;
}

export interface IQueueStatus {
  enabled: boolean;
  running: IQueueStatusEntry | null;
  pending: {
    total: number;
    byType: Record<string, number>;
    byProviderBucket: Record<string, number>;
  };
  items: IQueueStatusEntry[];
  averageWaitSeconds: number | null;
  oldestPendingAge: number | null;
}

export function fetchQueueStatus(): Promise<IQueueStatus> {
  return apiFetch<IQueueStatus>('/api/queue/status');
}

// ==================== Queue Analytics ====================

export interface IQueueAnalytics {
  recentRuns: Array<{
    id: number;
    projectPath: string;
    jobType: string;
    providerKey: string;
    status: string;
    startedAt: number;
    finishedAt: number | null;
    waitSeconds: number | null;
    durationSeconds: number | null;
    throttledCount: number;
  }>;
  byProviderBucket: Record<string, {
    running: number;
    pending: number;
  }>;
  averageWaitSeconds: number | null;
  oldestPendingAge: number | null;
}

export function fetchQueueAnalytics(windowHours?: number): Promise<IQueueAnalytics> {
  const query = windowHours !== undefined ? `?window=${encodeURIComponent(windowHours)}` : '';
  return apiFetch<IQueueAnalytics>(`/api/queue/analytics${query}`);
}

export function triggerClearQueue(force?: boolean): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/api/queue/clear', {
    method: 'POST',
    body: JSON.stringify({ force: force ?? false }),
  });
}

// ==================== Global Notifications ====================

export interface IGlobalNotificationsConfig {
  webhook: IWebhookConfig | null;
}

export function fetchGlobalNotifications(): Promise<IGlobalNotificationsConfig> {
  return apiFetch<IGlobalNotificationsConfig>('/api/global-notifications');
}

export function updateGlobalNotifications(
  config: IGlobalNotificationsConfig,
): Promise<IGlobalNotificationsConfig> {
  return apiFetch<IGlobalNotificationsConfig>('/api/global-notifications', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

// ==================== Roadmap Scanner ====================
// RoadmapItem and RoadmapStatus are imported from @night-watch/types above.

export interface ScanResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

export function fetchRoadmap(): Promise<IRoadmapStatus> {
  return apiFetch<IRoadmapStatus>(apiPath('/api/roadmap'));
}

export function triggerRoadmapScan(): Promise<ScanResult> {
  return apiFetch<ScanResult>(apiPath('/api/roadmap/scan'), { method: 'POST' });
}

export function toggleRoadmapScanner(enabled: boolean): Promise<INightWatchConfig> {
  return apiFetch<INightWatchConfig>(apiPath('/api/roadmap/toggle'), {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

// ==================== React Hook ====================

/**
 * Custom React hook for API data fetching with loading, error, and refetch.
 * Pass enabled=false to skip fetching (useful during global mode detection).
 *
 * Key design decisions to prevent infinite re-renders:
 * - fetchFn is stored in a ref so refetch callback is stable regardless of function identity
 * - refetch does NOT set loading=true — prevents flashing during polling
 * - Initial fetch and dependency changes still show loading state
 */
export function useApi<T>(
  fetchFn: () => Promise<T>,
  deps: DependencyList = [],
  options?: { enabled?: boolean }
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Store fetchFn in a ref to avoid dependency on function identity
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  // Stable refetch function that doesn't set loading (silent refresh)
  const refetch = useRef(() => {
    const doFetch = async () => {
      setError(null);
      try {
        const result = await fetchFnRef.current();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Unknown error'));
      }
    };
    doFetch();
  });

  // Initial fetch effect - shows loading state
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const doFetch = async () => {
      try {
        const result = await fetchFnRef.current();
        if (!cancelled) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error('Unknown error'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    doFetch();

    return () => {
      cancelled = true;
    };
  }, [...deps, enabled]);

  return { data, loading, error, refetch: refetch.current };
}
