/**
 * TypeScript interfaces for Night Watch CLI configuration
 */
import { IBoardProviderConfig } from "./board/types.js";
import { ISlackBotConfig } from "@/shared/types.js";
export type { ISlackBotConfig };
/**
 * Supported AI providers
 */
export type Provider = "claude" | "codex";
/**
 * Claude model to use for native (non-proxy) execution
 */
export type ClaudeModel = "sonnet" | "opus";
/**
 * Complete Night Watch configuration
 */
export interface INightWatchConfig {
    /** Default branch name (e.g. "main" or "master"). Empty string means auto-detect. */
    defaultBranch: string;
    /** Directory containing PRD files (relative to project root) */
    prdDir: string;
    /** Maximum runtime in seconds for PRD execution */
    maxRuntime: number;
    /** Maximum runtime in seconds for PR reviewer */
    reviewerMaxRuntime: number;
    /** Prefix for night-watch branches */
    branchPrefix: string;
    /** Branch patterns to match for PR reviewer */
    branchPatterns: string[];
    /** Minimum review score (out of 100) to consider PR complete */
    minReviewScore: number;
    /** Maximum log file size in bytes before rotation */
    maxLogSize: number;
    /** Cron schedule for PRD execution */
    cronSchedule: string;
    /** Cron schedule for PR reviewer */
    reviewerSchedule: string;
    /** Minute offset (0-59) applied to cron schedules during install. Helps stagger multiple projects. */
    cronScheduleOffset: number;
    /** Maximum retry attempts for rate-limited API calls (default: 3) */
    maxRetries: number;
    /** AI provider to use for execution */
    provider: Provider;
    /** Whether the reviewer is enabled */
    reviewerEnabled: boolean;
    /** Extra environment variables to pass to the provider CLI (e.g. API keys, base URLs) */
    providerEnv: Record<string, string>;
    /**
     * When true, automatically fall back to native Claude (OAuth / direct Anthropic API)
     * after the first rate-limit (429) on a proxy provider (e.g. GLM-5 via api.z.ai).
     * A Telegram warning is sent immediately when the fallback is triggered.
     * Default: false
     */
    fallbackOnRateLimit: boolean;
    /**
     * Claude model to use when running natively (i.e. when no ANTHROPIC_BASE_URL proxy
     * is set, or when falling back from a rate-limited proxy).
     * "sonnet" → claude-sonnet-4-6 (default)
     * "opus"   → claude-opus-4-6
     */
    claudeModel: ClaudeModel;
    /** Notification webhook configuration */
    notifications: INotificationConfig;
    /** PRD execution priority order (filenames without .md extension) */
    prdPriority: string[];
    /** Roadmap scanner configuration */
    roadmapScanner: IRoadmapScannerConfig;
    /** Directory containing custom template overrides (relative to project root) */
    templatesDir: string;
    /** Board provider configuration for PRD tracking */
    boardProvider: IBoardProviderConfig;
    /** Enable automatic merging of PRs that pass CI and review score threshold */
    autoMerge: boolean;
    /** Git merge method for auto-merge */
    autoMergeMethod: MergeMethod;
    /** QA process configuration */
    qa: IQaConfig;
    /** Code audit configuration */
    audit: IAuditConfig;
    /** Slack Bot API configuration (optional) */
    slack?: ISlackBotConfig;
}
export type QaArtifacts = "screenshot" | "video" | "both";
export interface IQaConfig {
    /** Whether the QA process is enabled */
    enabled: boolean;
    /** Cron schedule for QA execution */
    schedule: string;
    /** Maximum runtime in seconds for QA */
    maxRuntime: number;
    /** Branch patterns to match for QA (defaults to top-level branchPatterns if empty) */
    branchPatterns: string[];
    /** What artifacts to capture for UI tests */
    artifacts: QaArtifacts;
    /** GitHub label to skip QA (PRs with this label are excluded) */
    skipLabel: string;
    /** Auto-install Playwright if missing during QA run */
    autoInstallPlaywright: boolean;
}
export interface IAuditConfig {
    /** Whether the audit process is enabled */
    enabled: boolean;
    /** Cron schedule for audit execution */
    schedule: string;
    /** Maximum runtime in seconds for the audit */
    maxRuntime: number;
}
export type WebhookType = "slack" | "discord" | "telegram";
export type NotificationEvent = "run_started" | "run_succeeded" | "run_failed" | "run_timeout" | "review_completed" | "pr_auto_merged" | "rate_limit_fallback" | "qa_completed";
/**
 * Git merge methods for auto-merge
 */
export type MergeMethod = "squash" | "merge" | "rebase";
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
/**
 * Roadmap Scanner configuration
 */
export interface IRoadmapScannerConfig {
    /** Whether the roadmap scanner is enabled */
    enabled: boolean;
    /** Path to the ROADMAP.md file (relative to project root) */
    roadmapPath: string;
    /** Interval in seconds between automatic scans */
    autoScanInterval: number;
    /** Cron schedule for the slicer (AI-powered PRD generation from roadmap items) */
    slicerSchedule: string;
    /** Maximum runtime in seconds for the slicer */
    slicerMaxRuntime: number;
}
//# sourceMappingURL=types.d.ts.map