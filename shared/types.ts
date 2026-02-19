/**
 * Shared API contract types for Night Watch CLI.
 * These types represent the shape of data exchanged between the CLI server
 * and the web client over HTTP. Both sides must agree on these definitions.
 */

// ==================== Provider ====================

/** Supported AI providers */
export type Provider = "claude" | "codex";

// ==================== Notification / Webhook ====================

export type WebhookType = "slack" | "discord" | "telegram";
export type NotificationEvent =
  | "run_started"
  | "run_succeeded"
  | "run_failed"
  | "run_timeout"
  | "review_completed";

export interface IWebhookConfig {
  type: WebhookType;
  url?: string;
  botToken?: string;
  chatId?: string;
  events: NotificationEvent[];
}

export interface INotificationConfig {
  webhooks: IWebhookConfig[];
}

// ==================== Night Watch Config ====================

/**
 * The configuration object as returned by the /api/config endpoint.
 * This is the subset of INightWatchConfig that the web client consumes.
 */
export interface INightWatchConfig {
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
  cronScheduleOffset: number;
  maxRetries: number;
  provider: Provider;
  reviewerEnabled: boolean;
  providerEnv: Record<string, string>;
  notifications: INotificationConfig;
  prdPriority: string[];
  templatesDir: string;
}

// ==================== PRD Info ====================

export interface IPrdInfo {
  name: string;
  status: "ready" | "blocked" | "in-progress" | "pending-review" | "done";
  dependencies: string[];
  unmetDependencies: string[];
}

// ==================== Process Info ====================

export interface IProcessInfo {
  name: string;
  running: boolean;
  pid: number | null;
}

// ==================== PR Info ====================

export interface IPrInfo {
  number: number;
  title: string;
  branch: string;
  url: string;
  ciStatus: "pass" | "fail" | "pending" | "unknown";
  reviewScore: number | null;
}

// ==================== Log Info ====================

export interface ILogInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  lastLines: string[];
}

// ==================== Status Snapshot ====================

export interface IStatusSnapshot {
  projectName: string;
  projectDir: string;
  config: INightWatchConfig;
  prds: IPrdInfo[];
  processes: IProcessInfo[];
  prs: IPrInfo[];
  logs: ILogInfo[];
  crontab: { installed: boolean; entries: string[] };
  activePrd: string | null;
  timestamp: string;
}

// ==================== Roadmap ====================

export interface IRoadmapItem {
  hash: string;
  title: string;
  description: string;
  checked: boolean;
  section: string;
  processed: boolean;
  prdFile?: string;
}

export interface IRoadmapStatus {
  found: boolean;
  enabled: boolean;
  totalItems: number;
  processedItems: number;
  pendingItems: number;
  status: "idle" | "scanning" | "complete" | "disabled" | "no-roadmap";
  items: IRoadmapItem[];
  lastScan?: string;
  autoScanInterval?: number;
}
