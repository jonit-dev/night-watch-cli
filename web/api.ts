/**
 * API Client for Night Watch Web UI
 * Fetches real data from the CLI's HTTP API server
 * Supports both single-project and global (multi-project) modes
 */

import { DependencyList, useCallback, useEffect, useState } from 'react';

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
 * Build API path with optional project scoping.
 * In global mode: /api/status → /api/projects/{id}/status
 * In single-project mode: returns path unchanged.
 */
function apiPath(basePath: string): string {
  if (globalMode && currentProjectId) {
    return basePath.replace('/api/', `/api/projects/${encodeURIComponent(currentProjectId)}/`);
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

export interface StatusSnapshot {
  projectName: string;
  projectDir: string;
  config: NightWatchConfig;
  prds: PrdInfo[];
  processes: ProcessInfo[];
  prs: PrInfo[];
  logs: LogInfo[];
  crontab: { installed: boolean; entries: string[] };
  timestamp: string;
}

export interface NightWatchConfig {
  defaultBranch: string;
  prdDir: string;
  maxRuntime: number;
  reviewerMaxRuntime: number;
  branchPrefix: string;
  branchPatterns: string[];
  minReviewScore: number;
  maxLogSize: number;
  cronSchedule: string;
  reviewerSchedule: string;
  provider: 'claude' | 'codex';
  reviewerEnabled: boolean;
  providerEnv: Record<string, string>;
  notifications: NotificationConfig;
  prdPriority: string[];
}

export interface NotificationConfig {
  webhooks: WebhookConfig[];
}

export interface WebhookConfig {
  type: 'slack' | 'discord' | 'telegram';
  url?: string;
  botToken?: string;
  chatId?: string;
  events: ('run_succeeded' | 'run_failed' | 'run_timeout' | 'review_completed')[];
}

export interface PrdInfo {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'done';
  dependencies: string[];
  unmetDependencies: string[];
}

export interface ProcessInfo {
  name: string;
  running: boolean;
  pid: number | null;
}

export interface PrInfo {
  number: number;
  title: string;
  branch: string;
  url: string;
  ciStatus: 'pass' | 'fail' | 'pending' | 'unknown';
  reviewScore: number | null;
}

export interface LogInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  lastLines: string[];
}

// ==================== PRD with Content ====================

export interface PrdWithContent {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'done';
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

// ==================== React Hook ====================

/**
 * Custom React hook for API data fetching with loading, error, and refetch
 */
export function useApi<T>(
  fetchFn: () => Promise<T>,
  deps: DependencyList = []
): {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, fetchData]);

  return { data, loading, error, refetch: fetchData };
}
