import type {
  IStatusSnapshot,
  PrdWithContent,
  IPrInfo,
  ILogInfo,
  DoctorCheck,
  ActionResult,
  INightWatchConfig,
  IPrdInfo,
  IProcessInfo,
  INotificationConfig,
  IWebhookConfig,
} from './api';

// Re-export API types for convenience
export type {
  IStatusSnapshot as StatusSnapshot,
  PrdWithContent,
  IPrInfo as PrInfo,
  ILogInfo as LogInfo,
  DoctorCheck,
  ActionResult,
  INightWatchConfig as NightWatchConfig,
  IPrdInfo as PrdInfo,
  IProcessInfo as ProcessInfo,
  INotificationConfig as NotificationConfig,
  IWebhookConfig as WebhookConfig,
};

export enum Status {
  Ready = 'Ready',
  InProgress = 'In Progress',
  Blocked = 'Blocked',
  Done = 'Done',
  Failed = 'Failed',
}

export interface PRD {
  id: string;
  name: string;
  status: Status;
  priority: number | null;
  dependencies: string[]; // IDs of other PRDs
  content: string;
  created: string;
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  phases: number;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  branch: string;
  ciStatus: 'success' | 'failure' | 'pending' | 'unknown';
  reviewScore: number | null; // 0-100
  updated: string;
  author: string;
  checks: { name: string; status: 'success' | 'failure' | 'pending' }[];
  additions: number;
  deletions: number;
  filesChanged: number;
  body: string;
}

export interface ActionLog {
  id: string;
  action: string;
  status: 'Running' | 'Succeeded' | 'Failed' | 'Timed out';
  duration: string;
  target: string;
  timestamp: string;
  logs: string[];
}

export interface Notification {
  id: string;
  event: string;
  webhook: string;
  timestamp: string;
  status: 'sent' | 'failed';
}

export interface Project {
  id: string;
  name: string;
}
