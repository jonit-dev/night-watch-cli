/**
 * API Client for Night Watch Web UI
 * Fetches real data from the CLI's HTTP API server
 */

import { DependencyList, useCallback, useEffect, useState } from 'react';

/**
 * Base URL for API requests
 * Empty string for same-origin requests (production)
 * Vite proxy will handle /api paths during development
 */
export const API_BASE = '';

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

/**
 * Complete status snapshot from the API
 */
export interface StatusSnapshot {
  projectName: string;
  projectDir: string;
  config: NightWatchConfig;
  prds: PrdInfo[];
  processes: ProcessInfo[];
  prs: PrInfo[];
  logs: LogInfo[];
  crontab: { installed: boolean; entries: string[] };
  timestamp: string; // ISO date string
}

/**
 * Night Watch configuration
 */
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

/**
 * Notification configuration
 */
export interface NotificationConfig {
  webhooks: WebhookConfig[];
}

/**
 * Webhook configuration
 */
export interface WebhookConfig {
  type: 'slack' | 'discord' | 'telegram';
  url?: string;
  botToken?: string;
  chatId?: string;
  events: ('run_succeeded' | 'run_failed' | 'run_timeout' | 'review_completed')[];
}

/**
 * PRD information from status snapshot
 */
export interface PrdInfo {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'done';
  dependencies: string[];
  unmetDependencies: string[];
}

/**
 * Process information
 */
export interface ProcessInfo {
  name: string;
  running: boolean;
  pid: number | null;
}

/**
 * Pull request information
 */
export interface PrInfo {
  number: number;
  title: string;
  branch: string;
  ciStatus: 'pass' | 'fail' | 'pending' | 'unknown';
  reviewScore: number | null;
}

/**
 * Log file information
 */
export interface LogInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  lastLines: string[];
}

// ==================== PRD with Content ====================

/**
 * PRD with full content (from /api/prds)
 */
export interface PrdWithContent {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'done';
  dependencies: string[];
  unmetDependencies: string[];
  content?: string;
  path?: string;
}

/**
 * PRD content response (from /api/prds/:name)
 */
export interface PrdContent {
  name: string;
  content: string;
}

// ==================== Log Response ====================

/**
 * Log response (from /api/logs/:name)
 */
export interface LogResponse {
  name: string;
  lines: string[];
}

// ==================== Doctor Check ====================

/**
 * Doctor health check result
 */
export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

// ==================== Action Result ====================

/**
 * Action trigger response
 */
export interface ActionResult {
  started: boolean;
  pid?: number;
  error?: string;
}

// ==================== API Functions ====================

/**
 * Fetch complete status snapshot
 */
export function fetchStatus(): Promise<StatusSnapshot> {
  return apiFetch<StatusSnapshot>('/api/status');
}

/**
 * Fetch all PRDs with content
 */
export function fetchPrds(): Promise<PrdWithContent[]> {
  return apiFetch<PrdWithContent[]>('/api/prds');
}

/**
 * Fetch specific PRD content by name
 */
export function fetchPrdContent(name: string): Promise<PrdContent> {
  return apiFetch<PrdContent>(`/api/prds/${encodeURIComponent(name)}`);
}

/**
 * Fetch pull requests
 */
export function fetchPrs(): Promise<PrInfo[]> {
  return apiFetch<PrInfo[]>('/api/prs');
}

/**
 * Fetch log file lines
 */
export function fetchLogs(name: string, lines?: number): Promise<LogResponse> {
  const query = lines !== undefined ? `?lines=${encodeURIComponent(lines)}` : '';
  return apiFetch<LogResponse>(`/api/logs/${encodeURIComponent(name)}${query}`);
}

/**
 * Fetch current configuration
 */
export function fetchConfig(): Promise<NightWatchConfig> {
  return apiFetch<NightWatchConfig>('/api/config');
}

/**
 * Update configuration
 */
export function updateConfig(changes: Partial<NightWatchConfig>): Promise<NightWatchConfig> {
  return apiFetch<NightWatchConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(changes),
  });
}

/**
 * Fetch doctor health checks
 */
export function fetchDoctor(): Promise<DoctorCheck[]> {
  return apiFetch<DoctorCheck[]>('/api/doctor');
}

/**
 * Trigger executor run
 */
export function triggerRun(): Promise<ActionResult> {
  return apiFetch<ActionResult>('/api/actions/run', {
    method: 'POST',
  });
}

/**
 * Trigger reviewer run
 */
export function triggerReview(): Promise<ActionResult> {
  return apiFetch<ActionResult>('/api/actions/review', {
    method: 'POST',
  });
}

/**
 * Trigger cron installation
 */
export function triggerInstallCron(): Promise<ActionResult> {
  return apiFetch<ActionResult>('/api/actions/install-cron', {
    method: 'POST',
  });
}

/**
 * Trigger cron uninstallation
 */
export function triggerUninstallCron(): Promise<ActionResult> {
  return apiFetch<ActionResult>('/api/actions/uninstall-cron', {
    method: 'POST',
  });
}

// ==================== React Hook ====================

/**
 * Custom React hook for API data fetching with loading, error, and refetch
 *
 * @template T - The type of data returned by the fetch function
 * @param fetchFn - Function that returns a Promise of data
 * @param deps - Dependencies array for useEffect (when to refetch)
 * @returns Object with data, loading, error, and refetch function
 *
 * @example
 * const { data, loading, error, refetch } = useApi(fetchStatus, []);
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
