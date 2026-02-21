/**
 * Shared API contract types for Night Watch CLI.
 * These types represent the shape of data exchanged between the CLI server
 * and the web client over HTTP. Both sides must agree on these definitions.
 */

// ==================== Provider ====================

/** Supported AI providers */
export type Provider = 'claude' | 'codex';

// ==================== Notification / Webhook ====================

export type WebhookType = 'slack' | 'discord' | 'telegram';
export type NotificationEvent =
  | 'run_started'
  | 'run_succeeded'
  | 'run_failed'
  | 'run_timeout'
  | 'review_completed'
  | 'pr_auto_merged'
  | 'rate_limit_fallback'
  | 'qa_completed';

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

// ==================== Roadmap Scanner Config ====================

export interface IRoadmapScannerConfig {
  enabled: boolean;
  roadmapPath: string;
  autoScanInterval: number;
  slicerSchedule?: string;
  slicerMaxRuntime?: number;
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
  roadmapScanner: IRoadmapScannerConfig;
  templatesDir: string;
  slack?: ISlackBotConfig;
}

// ==================== PRD Info ====================

export interface IPrdInfo {
  name: string;
  status: 'ready' | 'blocked' | 'in-progress' | 'pending-review' | 'done';
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
  ciStatus: 'pass' | 'fail' | 'pending' | 'unknown';
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
  status: 'idle' | 'scanning' | 'complete' | 'disabled' | 'no-roadmap';
  items: IRoadmapItem[];
  lastScan?: string;
  autoScanInterval?: number;
}

// ==================== Slack Bot Config ====================

export interface ISlackBotConfig {
  enabled: boolean;
  botToken: string; // xoxb-...
  appToken?: string; // xapp-... for Socket Mode (optional)
  channels: {
    eng: string; // Channel ID for #eng
    prs: string; // Channel ID for #prs
    incidents: string; // Channel ID for #incidents
    releases: string; // Channel ID for #releases
  };
  autoCreateProjectChannels: boolean;
  discussionEnabled: boolean;
  replicateApiToken?: string; // For AI-generated persona avatars (Flux)
  serverBaseUrl?: string; // Public base URL of the Night Watch server (e.g. https://my-ngrok.io) used to serve local avatar images to Slack
}

// ==================== Agent Personas ====================

export interface IAgentModelConfig {
  provider: 'anthropic' | 'openai' | 'custom';
  model: string;
  baseUrl?: string;
  envVars?: Record<string, string>; // Stored encrypted; never returned by API in plaintext
  maxTokens?: number;
  temperature?: number;
}

export interface IAgentSoul {
  whoIAm: string;
  worldview: string[];
  opinions: Record<string, string[]>;
  expertise: string[];
  interests: string[];
  tensions: string[];
  boundaries: string[];
  petPeeves: string[];
}

export interface IAgentStyle {
  voicePrinciples: string;
  sentenceStructure: string;
  tone: string;
  wordsUsed: string[];
  wordsAvoided: string[];
  emojiUsage: {
    frequency: 'never' | 'rare' | 'moderate' | 'heavy';
    favorites: string[];
    contextRules: string;
  };
  quickReactions: Record<string, string>;
  rhetoricalMoves: string[];
  antiPatterns: Array<{ example: string; why: string }>;
  goodExamples: string[];
  badExamples: Array<{ example: string; why: string }>;
}

export interface IAgentSkill {
  modes: Record<string, string>;
  interpolationRules: string;
  additionalInstructions: string[];
}

export interface IAgentPersona {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
  soul: IAgentSoul;
  style: IAgentStyle;
  skill: IAgentSkill;
  modelConfig: IAgentModelConfig | null;
  systemPromptOverride: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export type CreateAgentPersonaInput = Pick<IAgentPersona, 'name' | 'role'> & {
  avatarUrl?: string;
  soul?: Partial<IAgentSoul>;
  style?: Partial<IAgentStyle>;
  skill?: Partial<IAgentSkill>;
  modelConfig?: IAgentModelConfig | null;
  systemPromptOverride?: string;
};

export type UpdateAgentPersonaInput = Partial<CreateAgentPersonaInput & { isActive: boolean }>;

// ==================== Slack Deliberation ====================

export type DiscussionStatus = 'active' | 'consensus' | 'blocked' | 'closed';
export type ConsensusResult = 'approved' | 'changes_requested' | 'human_needed';
export type TriggerType =
  | 'pr_review'
  | 'build_failure'
  | 'prd_kickoff'
  | 'code_watch'
  | 'issue_review'
  | 'slack_message';

export interface ISlackDiscussion {
  id: string;
  projectPath: string;
  triggerType: TriggerType;
  triggerRef: string; // PR number, PRD name, etc.
  channelId: string;
  threadTs: string;
  status: DiscussionStatus;
  round: number;
  participants: string[]; // Agent IDs that have contributed
  consensusResult: ConsensusResult | null;
  createdAt: number;
  updatedAt: number;
}

export interface IDiscussionTrigger {
  type: TriggerType;
  projectPath: string;
  ref: string; // PR number as string, PRD name, etc.
  context: string; // PR diff, failure message, PRD summary, etc.
  prUrl?: string;
  channelId?: string; // Explicit Slack channel override (e.g., project-specific channel)
  openingMessage?: string; // Override the generated opening message (e.g., AI-authored observation)
  threadTs?: string; // If set, skip opener post and anchor discussion in this existing thread
}

// ==================== Agent Memory ====================

export interface IMemoryEntry {
  date: string; // ISO date string e.g. "2026-02-20"
  persona: string;
  project: string;
  lessons: string[];
}

export interface IReflectionContext {
  triggerType: TriggerType;
  outcome: string;
  summary: string;
  filesChanged?: string[];
}

// LlmCaller — injected by callers (slack package) to avoid circular deps
export type LlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string>;
