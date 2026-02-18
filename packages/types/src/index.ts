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

export interface WebhookConfig {
  type: WebhookType;
  url?: string;
  botToken?: string;
  chatId?: string;
  events: NotificationEvent[];
}

export interface NotificationConfig {
  webhooks: WebhookConfig[];
}

// ==================== Night Watch Config ====================

/**
 * The configuration object as returned by the /api/config endpoint.
 * This is the subset of INightWatchConfig that the web client consumes.
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
  cronScheduleOffset: number;
  maxRetries: number;
  provider: Provider;
  reviewerEnabled: boolean;
  providerEnv: Record<string, string>;
  notifications: NotificationConfig;
  prdPriority: string[];
  templatesDir: string;
}

// ==================== PRD Info ====================

export interface PrdInfo {
  name: string;
  status: "ready" | "blocked" | "in-progress" | "pending-review" | "done";
  dependencies: string[];
  unmetDependencies: string[];
}

// ==================== Process Info ====================

export interface ProcessInfo {
  name: string;
  running: boolean;
  pid: number | null;
}

// ==================== PR Info ====================

export interface PrInfo {
  number: number;
  title: string;
  branch: string;
  url: string;
  ciStatus: "pass" | "fail" | "pending" | "unknown";
  reviewScore: number | null;
}

// ==================== Log Info ====================

export interface LogInfo {
  name: string;
  path: string;
  exists: boolean;
  size: number;
  lastLines: string[];
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

// ==================== Roadmap ====================

export interface RoadmapItem {
  hash: string;
  title: string;
  description: string;
  checked: boolean;
  section: string;
  processed: boolean;
  prdFile?: string;
}

export interface RoadmapStatus {
  found: boolean;
  enabled: boolean;
  totalItems: number;
  processedItems: number;
  pendingItems: number;
  status: "idle" | "scanning" | "complete" | "disabled" | "no-roadmap";
  items: RoadmapItem[];
  lastScan?: string;
  autoScanInterval?: number;
}
