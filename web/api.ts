/**
 * API Client for Night Watch Web UI
 * Fetches real data from the CLI's HTTP API server
 * Supports both single-project and global (multi-project) modes
 */

import { DependencyList, useEffect, useRef, useState } from 'react';
import type {
  NightWatchConfig,
  NotificationConfig,
  WebhookConfig,
  PrdInfo,
  ProcessInfo,
  PrInfo,
  LogInfo,
  StatusSnapshot,
  RoadmapItem,
  RoadmapStatus,
} from '@night-watch/types';

// Re-export shared types so consumers can import from either place
export type {
  NightWatchConfig,
  NotificationConfig,
  WebhookConfig,
  PrdInfo,
  ProcessInfo,
  PrInfo,
  LogInfo,
  StatusSnapshot,
  RoadmapItem,
  RoadmapStatus,
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

export function fetchProjects(): Promise<ProjectInfo[]> {
  return apiFetch<ProjectInfo[]>('/api/projects');
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

export interface ScheduleInfo {
  executor: { schedule: string; installed: boolean; nextRun: string | null };
  reviewer: { schedule: string; installed: boolean; nextRun: string | null };
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

export function fetchStatus(): Promise<StatusSnapshot> {
  return apiFetch<StatusSnapshot>(apiPath('/api/status'));
}

export function fetchPrds(): Promise<PrdWithContent[]> {
  return apiFetch<PrdWithContent[]>(apiPath('/api/prds'));
}

export function fetchPrdContent(name: string): Promise<PrdContent> {
  return apiFetch<PrdContent>(apiPath(`/api/prds/${encodeURIComponent(name)}`));
}

export function fetchPrs(): Promise<PrInfo[]> {
  return apiFetch<PrInfo[]>(apiPath('/api/prs'));
}

export function fetchLogs(name: string, lines?: number): Promise<LogResponse> {
  const query = lines !== undefined ? `?lines=${encodeURIComponent(lines)}` : '';
  return apiFetch<LogResponse>(apiPath(`/api/logs/${encodeURIComponent(name)}${query}`));
}

export function fetchConfig(): Promise<NightWatchConfig> {
  return apiFetch<NightWatchConfig>(apiPath('/api/config'));
}

export function updateConfig(changes: Partial<NightWatchConfig>): Promise<NightWatchConfig> {
  return apiFetch<NightWatchConfig>(apiPath('/api/config'), {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

export function fetchDoctor(): Promise<DoctorCheck[]> {
  return apiFetch<DoctorCheck[]>(apiPath('/api/doctor'));
}

export function fetchScheduleInfo(): Promise<ScheduleInfo> {
  return apiFetch<ScheduleInfo>(apiPath('/api/schedule-info'));
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

export function retryPrd(prdName: string): Promise<{ message: string }> {
  return apiFetch<{ message: string }>(apiPath('/api/actions/retry'), {
    method: 'POST',
    body: JSON.stringify({ prdName }),
  });
}

// ==================== Roadmap Scanner ====================
// RoadmapItem and RoadmapStatus are imported from @night-watch/types above.

export interface ScanResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

export function fetchRoadmap(): Promise<RoadmapStatus> {
  return apiFetch<RoadmapStatus>(apiPath('/api/roadmap'));
}

export function triggerRoadmapScan(): Promise<ScanResult> {
  return apiFetch<ScanResult>(apiPath('/api/roadmap/scan'), { method: 'POST' });
}

export function toggleRoadmapScanner(enabled: boolean): Promise<NightWatchConfig> {
  return apiFetch<NightWatchConfig>(apiPath('/api/roadmap/toggle'), {
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
