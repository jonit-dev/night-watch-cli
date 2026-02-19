/**
 * API Client for Night Watch Web UI
 * Fetches real data from the CLI's HTTP API server
 * Supports both single-project and global (multi-project) modes
 */

import type {
  ILogInfo,
  INightWatchConfig,
  INotificationConfig,
  IPrdInfo,
  IPrInfo,
  IProcessInfo,
  IRoadmapItem,
  IRoadmapScannerConfig,
  IRoadmapStatus,
  ISlackBotConfig,
  IStatusSnapshot,
  IWebhookConfig,
} from '@shared/types';
import { DependencyList, useEffect, useRef, useState } from 'react';

// Re-export shared types so consumers can import from either place
export type {
  ILogInfo,
  INightWatchConfig,
  INotificationConfig,
  IPrdInfo,
  IPrInfo,
  IProcessInfo,
  IRoadmapItem,
  IRoadmapScannerConfig,
  IRoadmapStatus,
  ISlackBotConfig,
  IStatusSnapshot,
  IWebhookConfig,
};

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
    return basePath.replace(
      '/api/',
      `/api/projects/${encodeProjectId(currentProjectId)}/`,
    );
  }
  return basePath;
}

// ==================== Project List (global mode only) ====================

export interface ProjectInfo {
  name: string;
  path: string;
  valid: boolean;
}

export function fetchProjects(): Promise<ProjectInfo[]> {
  return apiFetch<ProjectInfo[]>('/api/projects');
}

// ==================== Generic Fetch ====================

/**
 * Generic API fetch wrapper with error handling
 */
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: 'Unknown error' }));
    throw new Error(
      error.error || `HTTP ${response.status}: ${response.statusText}`,
    );
  }

  // Some endpoints (e.g. DELETE) intentionally return 204 with no JSON body.
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ==================== Status Snapshot ====================
// StatusSnapshot, NightWatchConfig, NotificationConfig, WebhookConfig,
// PrdInfo, ProcessInfo, PrInfo, and LogInfo are imported from @night-watch/types above.

// ==================== PRD with Content ====================

export interface PrdWithContent {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'pending-review' | 'done';
  dependencies: string[];
  unmetDependencies: string[];
  content?: string;
  path?: string;
}

export interface PrdContent {
  name: string;
  content: string;
}

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
  executor: { schedule: string; installed: boolean; nextRun: string | null };
  reviewer: { schedule: string; installed: boolean; nextRun: string | null };
  qa: { schedule: string; installed: boolean; nextRun: string | null };
  paused: boolean;
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

export function fetchPrds(): Promise<PrdWithContent[]> {
  return apiFetch<PrdWithContent[]>(apiPath('/api/prds'));
}

export function fetchPrdContent(name: string): Promise<PrdContent> {
  return apiFetch<PrdContent>(apiPath(`/api/prds/${encodeURIComponent(name)}`));
}

export function fetchPrs(): Promise<IPrInfo[]> {
  return apiFetch<IPrInfo[]>(apiPath('/api/prs'));
}

export function fetchLogs(name: string, lines?: number): Promise<LogResponse> {
  const query =
    lines !== undefined ? `?lines=${encodeURIComponent(lines)}` : '';
  return apiFetch<LogResponse>(
    apiPath(`/api/logs/${encodeURIComponent(name)}${query}`),
  );
}

export function fetchConfig(): Promise<INightWatchConfig> {
  return apiFetch<INightWatchConfig>(apiPath('/api/config'));
}

export function updateConfig(
  changes: Partial<INightWatchConfig>,
): Promise<INightWatchConfig> {
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

export function triggerRun(prdName?: string): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/run'), {
    method: 'POST',
    headers: prdName ? { 'Content-Type': 'application/json' } : undefined,
    body: prdName ? JSON.stringify({ prdName }) : undefined,
  });
}

export function triggerReview(): Promise<ActionResult> {
  return apiFetch<ActionResult>(apiPath('/api/actions/review'), {
    method: 'POST',
  });
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

export function triggerCancel(
  type: 'run' | 'review' | 'all' = 'all',
): Promise<CancelActionResult> {
  return apiFetch<CancelActionResult>(apiPath('/api/actions/cancel'), {
    method: 'POST',
    body: JSON.stringify({ type }),
  });
}

export function retryPrd(prdName: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(apiPath('/api/actions/retry'), {
    method: 'POST',
    body: JSON.stringify({ prdName }),
  });
}

export function triggerClearLock(): Promise<{ cleared: boolean }> {
  return apiFetch<{ cleared: boolean }>(apiPath('/api/actions/clear-lock'), {
    method: 'POST',
  });
}

// ==================== Board ====================

export type BoardColumnName =
  | 'Draft'
  | 'Ready'
  | 'In Progress'
  | 'Review'
  | 'Done';

export const BOARD_COLUMNS: BoardColumnName[] = [
  'Draft',
  'Ready',
  'In Progress',
  'Review',
  'Done',
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

export interface ICreateIssueInput {
  title: string;
  body: string;
  column?: BoardColumnName;
}

export function fetchBoardStatus(): Promise<IBoardStatus> {
  return apiFetch<IBoardStatus>(apiPath('/api/board/status'));
}

export function fetchBoardIssues(): Promise<IBoardIssue[]> {
  return apiFetch<IBoardIssue[]>(apiPath('/api/board/issues'));
}

export function createBoardIssue(
  input: ICreateIssueInput,
): Promise<IBoardIssue> {
  return apiFetch<IBoardIssue>(apiPath('/api/board/issues'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function moveBoardIssue(
  number: number,
  column: BoardColumnName,
): Promise<{ moved: boolean }> {
  return apiFetch<{ moved: boolean }>(
    apiPath(`/api/board/issues/${number}/move`),
    {
      method: 'PATCH',
      body: JSON.stringify({ column }),
    },
  );
}

export function commentBoardIssue(
  number: number,
  body: string,
): Promise<{ commented: boolean }> {
  return apiFetch<{ commented: boolean }>(
    apiPath(`/api/board/issues/${number}/comment`),
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
}

export function closeBoardIssue(number: number): Promise<{ closed: boolean }> {
  return apiFetch<{ closed: boolean }>(apiPath(`/api/board/issues/${number}`), {
    method: 'DELETE',
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

export function toggleRoadmapScanner(
  enabled: boolean,
): Promise<INightWatchConfig> {
  return apiFetch<INightWatchConfig>(apiPath('/api/roadmap/toggle'), {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

// ==================== Slack Channels ====================

export interface ISlackChannel {
  id: string;
  name: string;
}

export function createSlackChannel(botToken: string, name: string): Promise<string> {
  return apiFetch<string>(apiPath('/api/slack/channels/create'), {
    method: 'POST',
    body: JSON.stringify({ botToken, name }),
  });
}

export function fetchSlackChannels(botToken: string): Promise<ISlackChannel[]> {
  return apiFetch<ISlackChannel[]>(apiPath('/api/slack/channels'), {
    method: 'POST',
    body: JSON.stringify({ botToken }),
  });
}

// ==================== Agent Personas ====================

import type {
  CreateAgentPersonaInput,
  IAgentModelConfig,
  IAgentPersona,
  IAgentSkill,
  IAgentSoul,
  IAgentStyle,
  UpdateAgentPersonaInput,
} from '@shared/types';

export type {
  CreateAgentPersonaInput,
  IAgentModelConfig,
  IAgentPersona,
  IAgentSkill,
  IAgentSoul,
  IAgentStyle,
  UpdateAgentPersonaInput,
};

export function fetchAgents(): Promise<IAgentPersona[]> {
  return apiFetch<IAgentPersona[]>(apiPath('/api/agents'));
}

export function fetchAgent(id: string): Promise<IAgentPersona> {
  return apiFetch<IAgentPersona>(apiPath(`/api/agents/${id}`));
}

export function fetchAgentPrompt(id: string): Promise<{ prompt: string }> {
  return apiFetch<{ prompt: string }>(apiPath(`/api/agents/${id}/prompt`));
}

export function createAgent(
  input: CreateAgentPersonaInput,
): Promise<IAgentPersona> {
  return apiFetch<IAgentPersona>(apiPath('/api/agents'), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateAgent(
  id: string,
  input: UpdateAgentPersonaInput,
): Promise<IAgentPersona> {
  return apiFetch<IAgentPersona>(apiPath(`/api/agents/${id}`), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function deleteAgent(id: string): Promise<void> {
  return apiFetch<void>(apiPath(`/api/agents/${id}`), {
    method: 'DELETE',
  });
}

export function seedDefaultAgents(): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(apiPath('/api/agents/seed-defaults'), {
    method: 'POST',
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
  options?: { enabled?: boolean },
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
  refetch.current = refetch.current.bind(refetch);

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

// ==================== SSE Hook ====================

/**
 * Custom React hook for subscribing to real-time status updates via SSE.
 * Provides sub-second updates when the server state changes.
 * Automatically reconnects on connection errors.
 *
 * @param onSnapshot Callback function called with each status snapshot
 * @param deps Dependency list (e.g., [selectedProjectId] to re-subscribe when project changes)
 */
export function useStatusStream(
  onSnapshot: (snapshot: IStatusSnapshot) => void,
  deps: DependencyList = [],
): void {
  useEffect(() => {
    const url = apiPath('/api/status/events');
    const es = new EventSource(url);

    es.addEventListener('status_changed', (e: MessageEvent) => {
      try {
        const snapshot = JSON.parse(e.data) as IStatusSnapshot;
        onSnapshot(snapshot);
      } catch {
        // Silently ignore parse errors
      }
    });

    es.addEventListener('executor_started', (e: MessageEvent) => {
      // This event just signals that executor started; status_changed will follow
      try {
        const data = JSON.parse(e.data);
        // Could be used for optimistic UI updates if needed
        console.log('Executor started with PID:', data.pid);
      } catch {
        // Silently ignore parse errors
      }
    });

    es.onerror = () => {
      // EventSource automatically reconnects, so we just log for debugging
      // No action needed - reconnection is automatic
    };

    return () => {
      es.close();
    };
    // deps is intentionally used to re-subscribe when project changes
  }, deps);
}
