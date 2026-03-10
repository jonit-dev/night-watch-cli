/**
 * Default configuration values for Night Watch CLI
 */

import { IBoardProviderConfig } from './board/types.js';
import {
  ClaudeModel,
  IAuditConfig,
  IJobProviders,
  INotificationConfig,
  IProviderPreset,
  IQaConfig,
  IQueueConfig,
  IRoadmapScannerConfig,
  JobType,
  MergeMethod,
  Provider,
  QaArtifacts,
  QueueMode,
} from './types.js';

// Branch Configuration (default branch)
export const DEFAULT_DEFAULT_BRANCH = ''; // empty = auto-detect

// PRD Configuration
export const DEFAULT_PRD_DIR = 'docs/prds';

// Runtime Configuration (in seconds)
export const DEFAULT_MAX_RUNTIME = 7200;
export const DEFAULT_REVIEWER_MAX_RUNTIME = 3600;

// Cron Schedule Configuration
export const DEFAULT_CRON_SCHEDULE = '5 */2 * * *';
export const DEFAULT_REVIEWER_SCHEDULE = '25 */3 * * *';

// Schedule Offset
export const DEFAULT_CRON_SCHEDULE_OFFSET = 0;

// Max Retries for rate-limited API calls
export const DEFAULT_MAX_RETRIES = 3;

// Reviewer Retry Configuration
export const DEFAULT_REVIEWER_MAX_RETRIES = 2;
export const DEFAULT_REVIEWER_RETRY_DELAY = 30; // seconds

// Branch Configuration
export const DEFAULT_BRANCH_PREFIX = 'night-watch';
export const DEFAULT_BRANCH_PATTERNS = ['feat/', 'night-watch/'];

// Review Configuration
export const DEFAULT_MIN_REVIEW_SCORE = 80;

// Log Configuration
export const DEFAULT_MAX_LOG_SIZE = 524288; // 512 KB

// Provider Configuration
export const DEFAULT_PROVIDER: Provider = 'claude';
export const DEFAULT_EXECUTOR_ENABLED = true;
export const DEFAULT_REVIEWER_ENABLED = true;
export const DEFAULT_PROVIDER_ENV: Record<string, string> = {};

// Rate-limit fallback
export const DEFAULT_FALLBACK_ON_RATE_LIMIT = true;

// Claude model selection (for native / fallback execution)
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = 'sonnet';
export const DEFAULT_PRIMARY_FALLBACK_MODEL: ClaudeModel = DEFAULT_CLAUDE_MODEL;
export const DEFAULT_SECONDARY_FALLBACK_MODEL: ClaudeModel = DEFAULT_PRIMARY_FALLBACK_MODEL;
export const VALID_CLAUDE_MODELS: ClaudeModel[] = ['sonnet', 'opus'];
/** Full Anthropic model IDs used in the --model flag */
export const CLAUDE_MODEL_IDS: Record<ClaudeModel, string> = {
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-6',
};

// Notification Configuration
export const DEFAULT_NOTIFICATIONS: INotificationConfig = { webhooks: [] };

// PRD Priority Configuration
export const DEFAULT_PRD_PRIORITY: string[] = [];

// Roadmap Scanner Configuration
export const DEFAULT_SLICER_SCHEDULE = '35 */6 * * *'; // every 6 hours (staggered)
export const DEFAULT_SLICER_MAX_RUNTIME = 600; // 10 minutes

export const DEFAULT_ROADMAP_SCANNER: IRoadmapScannerConfig = {
  enabled: true,
  roadmapPath: 'ROADMAP.md',
  autoScanInterval: 300,
  slicerSchedule: DEFAULT_SLICER_SCHEDULE,
  slicerMaxRuntime: DEFAULT_SLICER_MAX_RUNTIME,
  priorityMode: 'roadmap-first',
  issueColumn: 'Draft',
};

// Templates Configuration
export const DEFAULT_TEMPLATES_DIR = '.night-watch/templates';

// Board Provider Configuration
export const DEFAULT_BOARD_PROVIDER: IBoardProviderConfig = {
  enabled: true,
  provider: 'github' as const,
};

export const DEFAULT_LOCAL_BOARD_INFO = { id: 'local', number: 0, title: 'Local Kanban', url: '' };

// Auto-Merge Configuration
export const DEFAULT_AUTO_MERGE = false;
export const DEFAULT_AUTO_MERGE_METHOD: MergeMethod = 'squash';
export const VALID_MERGE_METHODS: MergeMethod[] = ['squash', 'merge', 'rebase'];

// QA Configuration
export const DEFAULT_QA_ENABLED = true;
export const DEFAULT_QA_SCHEDULE = '45 2,10,18 * * *'; // 3x daily, staggered
export const DEFAULT_QA_MAX_RUNTIME = 3600; // 1 hour
export const DEFAULT_QA_ARTIFACTS: QaArtifacts = 'both';
export const DEFAULT_QA_SKIP_LABEL = 'skip-qa';
export const DEFAULT_QA_AUTO_INSTALL_PLAYWRIGHT = true;

export const DEFAULT_QA: IQaConfig = {
  enabled: DEFAULT_QA_ENABLED,
  schedule: DEFAULT_QA_SCHEDULE,
  maxRuntime: DEFAULT_QA_MAX_RUNTIME,
  branchPatterns: [],
  artifacts: DEFAULT_QA_ARTIFACTS,
  skipLabel: DEFAULT_QA_SKIP_LABEL,
  autoInstallPlaywright: DEFAULT_QA_AUTO_INSTALL_PLAYWRIGHT,
};

export const QA_LOG_NAME = 'night-watch-qa';

// Audit Configuration
export const DEFAULT_AUDIT_ENABLED = true;
export const DEFAULT_AUDIT_SCHEDULE = '50 3 * * 1'; // weekly Monday 03:50
export const DEFAULT_AUDIT_MAX_RUNTIME = 1800; // 30 minutes

export const DEFAULT_AUDIT: IAuditConfig = {
  enabled: DEFAULT_AUDIT_ENABLED,
  schedule: DEFAULT_AUDIT_SCHEDULE,
  maxRuntime: DEFAULT_AUDIT_MAX_RUNTIME,
};

export const AUDIT_LOG_NAME = 'audit';
export const PLANNER_LOG_NAME = 'slicer';

// Valid providers (backward compat - derived from built-in presets)
export const VALID_PROVIDERS: Provider[] = ['claude', 'codex'];

// Valid job types for per-job provider configuration
export const VALID_JOB_TYPES: JobType[] = ['executor', 'reviewer', 'qa', 'audit', 'slicer'];

// Default per-job provider configuration (empty = use global provider)
export const DEFAULT_JOB_PROVIDERS: IJobProviders = {};

/**
 * Built-in provider presets. These are the default configurations for known providers.
 * Users can override these or add custom presets via config.providerPresets.
 */
export const BUILT_IN_PRESETS: Record<string, IProviderPreset> = {
  claude: {
    name: 'Claude',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
  },
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'claude-sonnet-4-6',
  },
  'claude-opus-4-6': {
    name: 'Claude Opus 4.6',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'claude-opus-4-6',
  },
  codex: {
    name: 'Codex',
    command: 'codex',
    subcommand: 'exec',
    autoApproveFlag: '--yolo',
    workdirFlag: '-C',
  },
  'glm-47': {
    name: 'GLM-4.7',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'glm-4.7',
    envVars: {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      API_TIMEOUT_MS: '3000000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
    },
  },
  'glm-5': {
    name: 'GLM-5',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'glm-5',
    envVars: {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      API_TIMEOUT_MS: '3000000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5',
    },
  },
};

/** Built-in preset IDs for convenience */
export const BUILT_IN_PRESET_IDS = Object.keys(BUILT_IN_PRESETS) as readonly string[];

// Provider commands configuration (derived from built-in presets for backward compat)
export const PROVIDER_COMMANDS: Record<string, string> = {
  claude: BUILT_IN_PRESETS.claude!.command,
  codex: BUILT_IN_PRESETS.codex!.command,
};

// File Names and Paths
export const CONFIG_FILE_NAME = 'night-watch.config.json';
export const LOCK_FILE_PREFIX = '/tmp/night-watch-';
export const LOG_DIR = 'logs';
export const CLAIM_FILE_EXTENSION = '.claim';

// Log file names (must match what executor/reviewer create)
export const EXECUTOR_LOG_NAME = 'executor';
export const REVIEWER_LOG_NAME = 'reviewer';

// Log file extensions
export const EXECUTOR_LOG_FILE = 'executor.log';
export const REVIEWER_LOG_FILE = 'reviewer.log';

// Mapping from logical API names to actual file names
export const LOG_FILE_NAMES: Record<string, string> = {
  executor: EXECUTOR_LOG_NAME,
  reviewer: REVIEWER_LOG_NAME,
  qa: QA_LOG_NAME,
  audit: AUDIT_LOG_NAME,
  planner: PLANNER_LOG_NAME,
};

// Global Registry
export const GLOBAL_CONFIG_DIR = '.night-watch';
export const REGISTRY_FILE_NAME = 'projects.json';
export const HISTORY_FILE_NAME = 'history.json';
export const PRD_STATES_FILE_NAME = 'prd-states.json';
export const STATE_DB_FILE_NAME = 'state.db';

// Execution History
export const MAX_HISTORY_RECORDS_PER_PRD = 10;

// Global Job Queue Configuration
export const DEFAULT_QUEUE_ENABLED = true;
export const DEFAULT_QUEUE_MODE: QueueMode = 'conservative';
export const DEFAULT_QUEUE_MAX_CONCURRENCY = 1;
export const DEFAULT_QUEUE_MAX_WAIT_TIME = 7200; // 2 hours in seconds
export const DEFAULT_QUEUE_PRIORITY: Record<string, number> = {
  executor: 50,
  reviewer: 40,
  slicer: 30,
  qa: 20,
  audit: 10,
};

export const DEFAULT_QUEUE: IQueueConfig = {
  enabled: DEFAULT_QUEUE_ENABLED,
  mode: DEFAULT_QUEUE_MODE,
  maxConcurrency: DEFAULT_QUEUE_MAX_CONCURRENCY,
  maxWaitTime: DEFAULT_QUEUE_MAX_WAIT_TIME,
  priority: { ...DEFAULT_QUEUE_PRIORITY },
  providerBuckets: {},
};

// Cross-project scheduling priority (higher = earlier slot / stronger queue tie-breaker)
export const DEFAULT_SCHEDULING_PRIORITY = 3;

/**
 * Resolve a canonical provider bucket key from a provider name and optional providerEnv.
 *
 * Examples:
 *   resolveProviderBucketKey('codex')                                  → 'codex'
 *   resolveProviderBucketKey('claude', {})                             → 'claude-native'
 *   resolveProviderBucketKey('claude', { ANTHROPIC_BASE_URL: 'https://api.z.ai/...' }) → 'claude-proxy:api.z.ai'
 *
 * The key is used to group in-flight jobs into provider buckets for capacity checks.
 */
export function resolveProviderBucketKey(
  provider: Provider,
  providerEnv?: Record<string, string>,
): string {
  if (provider === 'codex') return 'codex';
  const baseUrl = providerEnv?.ANTHROPIC_BASE_URL;
  if (!baseUrl) return 'claude-native';
  try {
    const host = new URL(baseUrl).hostname;
    return `claude-proxy:${host}`;
  } catch {
    return `claude-proxy:${baseUrl}`;
  }
}

// Queue lock file path (relative to global config dir)
export const QUEUE_LOCK_FILE_NAME = 'queue.lock';
