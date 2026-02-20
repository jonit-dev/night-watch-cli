/**
 * Default configuration values for Night Watch CLI
 */
// Branch Configuration (default branch)
export const DEFAULT_DEFAULT_BRANCH = ""; // empty = auto-detect
// PRD Configuration
export const DEFAULT_PRD_DIR = "docs/PRDs/night-watch";
// Runtime Configuration (in seconds)
export const DEFAULT_MAX_RUNTIME = 7200;
export const DEFAULT_REVIEWER_MAX_RUNTIME = 3600;
// Cron Schedule Configuration
export const DEFAULT_CRON_SCHEDULE = "0 0-21 * * *";
export const DEFAULT_REVIEWER_SCHEDULE = "0 0,3,6,9,12,15,18,21 * * *";
// Schedule Offset
export const DEFAULT_CRON_SCHEDULE_OFFSET = 0;
// Max Retries for rate-limited API calls
export const DEFAULT_MAX_RETRIES = 3;
// Branch Configuration
export const DEFAULT_BRANCH_PREFIX = "night-watch";
export const DEFAULT_BRANCH_PATTERNS = ["feat/", "night-watch/"];
// Review Configuration
export const DEFAULT_MIN_REVIEW_SCORE = 80;
// Log Configuration
export const DEFAULT_MAX_LOG_SIZE = 524288; // 512 KB
// Provider Configuration
export const DEFAULT_PROVIDER = "claude";
export const DEFAULT_REVIEWER_ENABLED = true;
export const DEFAULT_PROVIDER_ENV = {};
// Rate-limit fallback
export const DEFAULT_FALLBACK_ON_RATE_LIMIT = false;
// Claude model selection (for native / fallback execution)
export const DEFAULT_CLAUDE_MODEL = "sonnet";
export const VALID_CLAUDE_MODELS = ["sonnet", "opus"];
/** Full Anthropic model IDs used in the --model flag */
export const CLAUDE_MODEL_IDS = {
    sonnet: "claude-sonnet-4-6",
    opus: "claude-opus-4-6",
};
// Notification Configuration
export const DEFAULT_NOTIFICATIONS = { webhooks: [] };
// PRD Priority Configuration
export const DEFAULT_PRD_PRIORITY = [];
// Roadmap Scanner Configuration
export const DEFAULT_SLICER_SCHEDULE = "0 */6 * * *"; // every 6 hours
export const DEFAULT_SLICER_MAX_RUNTIME = 600; // 10 minutes
export const DEFAULT_ROADMAP_SCANNER = {
    enabled: false,
    roadmapPath: "ROADMAP.md",
    autoScanInterval: 300,
    slicerSchedule: DEFAULT_SLICER_SCHEDULE,
    slicerMaxRuntime: DEFAULT_SLICER_MAX_RUNTIME,
};
// Templates Configuration
export const DEFAULT_TEMPLATES_DIR = ".night-watch/templates";
// Board Provider Configuration
export const DEFAULT_BOARD_PROVIDER = {
    enabled: true,
    provider: "github",
};
// Auto-Merge Configuration
export const DEFAULT_AUTO_MERGE = false;
export const DEFAULT_AUTO_MERGE_METHOD = "squash";
export const VALID_MERGE_METHODS = ["squash", "merge", "rebase"];
// QA Configuration
export const DEFAULT_QA_ENABLED = true;
export const DEFAULT_QA_SCHEDULE = "30 1,7,13,19 * * *"; // 4x daily, offset from reviewer
export const DEFAULT_QA_MAX_RUNTIME = 3600; // 1 hour
export const DEFAULT_QA_ARTIFACTS = "both";
export const DEFAULT_QA_SKIP_LABEL = "skip-qa";
export const DEFAULT_QA_AUTO_INSTALL_PLAYWRIGHT = true;
export const DEFAULT_QA = {
    enabled: DEFAULT_QA_ENABLED,
    schedule: DEFAULT_QA_SCHEDULE,
    maxRuntime: DEFAULT_QA_MAX_RUNTIME,
    branchPatterns: [],
    artifacts: DEFAULT_QA_ARTIFACTS,
    skipLabel: DEFAULT_QA_SKIP_LABEL,
    autoInstallPlaywright: DEFAULT_QA_AUTO_INSTALL_PLAYWRIGHT,
};
export const QA_LOG_NAME = "night-watch-qa";
// Audit Configuration
export const DEFAULT_AUDIT_ENABLED = true;
export const DEFAULT_AUDIT_SCHEDULE = "0 3 * * *"; // daily at 3am
export const DEFAULT_AUDIT_MAX_RUNTIME = 1800; // 30 minutes
export const DEFAULT_AUDIT = {
    enabled: DEFAULT_AUDIT_ENABLED,
    schedule: DEFAULT_AUDIT_SCHEDULE,
    maxRuntime: DEFAULT_AUDIT_MAX_RUNTIME,
};
export const AUDIT_LOG_NAME = "audit";
// Slack Bot Configuration
export const DEFAULT_SLACK_BOT_CONFIG = {
    enabled: false,
    botToken: '',
    channels: { eng: '', prs: '', incidents: '', releases: '' },
    autoCreateProjectChannels: false,
    discussionEnabled: false,
};
// Valid providers
export const VALID_PROVIDERS = ["claude", "codex"];
// Provider commands configuration
export const PROVIDER_COMMANDS = {
    claude: "claude",
    codex: "codex",
};
// File Names and Paths
export const CONFIG_FILE_NAME = "night-watch.config.json";
export const LOCK_FILE_PREFIX = "/tmp/night-watch-";
export const LOG_DIR = "logs";
export const CLAIM_FILE_EXTENSION = ".claim";
// Log file names (must match what executor/reviewer create)
export const EXECUTOR_LOG_NAME = "executor";
export const REVIEWER_LOG_NAME = "reviewer";
// Log file extensions
export const EXECUTOR_LOG_FILE = "executor.log";
export const REVIEWER_LOG_FILE = "reviewer.log";
// Mapping from logical API names to actual file names
export const LOG_FILE_NAMES = {
    executor: EXECUTOR_LOG_NAME,
    reviewer: REVIEWER_LOG_NAME,
    qa: QA_LOG_NAME,
};
// Global Registry
export const GLOBAL_CONFIG_DIR = ".night-watch";
export const REGISTRY_FILE_NAME = "projects.json";
export const HISTORY_FILE_NAME = "history.json";
export const PRD_STATES_FILE_NAME = "prd-states.json";
export const STATE_DB_FILE_NAME = "state.db";
// Execution History
export const MAX_HISTORY_RECORDS_PER_PRD = 10;
//# sourceMappingURL=constants.js.map