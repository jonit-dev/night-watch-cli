import type { BoardColumnName, IBoardIssue, IBoardProvider } from '../board/types.js';
import type { IManagerConfig, INightWatchConfig, IQueueStatus, Provider } from '../types.js';
import type { IStatusSnapshot } from '../utils/status-data.js';

export type ManagerFindingKind =
  | 'roadmap_gap'
  | 'blocked_prd'
  | 'stale_queue'
  | 'missing_manager_doc';

export type ManagerFindingSeverity = 'info' | 'warning' | 'blocker';

export interface IManagerResolvedConfig extends IManagerConfig {
  memoryFile: string;
  docsDirectory: string;
}

export interface IManagerFinding {
  kind: ManagerFindingKind;
  severity: ManagerFindingSeverity;
  title: string;
  body: string;
  fingerprint: string;
  requiresHuman: boolean;
  source: string;
  labels: string[];
}

export interface IManagerDraftIssue {
  title: string;
  body: string;
  labels: string[];
  column: BoardColumnName;
  fingerprint: string;
}

export interface IManagerCreatedDraft extends IManagerDraftIssue {
  issue: IBoardIssue;
}

export interface IManagerSkippedFinding {
  fingerprint: string;
  title: string;
  reason: 'memory' | 'board';
}

export interface IManagerMemoryState {
  fingerprints: Set<string>;
  lastWeeklySummaryAt: Date | null;
  raw: string;
}

export interface IManagerNotificationDecision {
  event: 'manager_blocked' | 'manager_weekly_summary';
  shouldNotify: boolean;
  title: string;
  body: string;
  findings: IManagerFinding[];
}

export interface IManagerRunOptions {
  dryRun?: boolean;
  timeout?: number;
  provider?: Provider;
  now?: Date;
  boardProvider?: IBoardProvider | null;
  statusSnapshot?: IStatusSnapshot | null;
  queueStatus?: IQueueStatus | null;
}

export interface IManagerRunResult {
  dryRun: boolean;
  projectDir: string;
  config: IManagerResolvedConfig;
  analyzed: {
    roadmapItems: number;
    boardIssues: number;
    prds: number;
  };
  findings: IManagerFinding[];
  proposedDrafts: IManagerDraftIssue[];
  createdDrafts: IManagerCreatedDraft[];
  skippedFindings: IManagerSkippedFinding[];
  docsWritten: string[];
  memoryWritten: boolean;
  notificationDecisions: IManagerNotificationDecision[];
  summary: string;
}

export interface IManagerRunContext {
  projectDir: string;
  config: INightWatchConfig;
  managerConfig: IManagerResolvedConfig;
  dryRun: boolean;
  now: Date;
  boardIssues: IBoardIssue[];
  statusSnapshot: IStatusSnapshot | null;
  queueStatus: IQueueStatus | null;
}
