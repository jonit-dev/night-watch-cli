import { PRD, PullRequest, Status, ActionLog, Project, Notification } from './types';

export const PROJECTS: Project[] = [
  { id: '1', name: 'Night Watch Core' },
  { id: '2', name: 'Nebula Dashboard' },
  { id: '3', name: 'Orion Gateway' },
];

export const MOCK_PRDS: PRD[] = [
  {
    id: 'prd-1',
    name: 'Implement Sidebar Navigation',
    status: Status.Done,
    priority: 1,
    dependencies: [],
    content: '# Sidebar Implementation\n\nCreate a collapsible sidebar...',
    created: '2023-10-25',
    complexity: 'LOW',
    phases: 1
  },
  {
    id: 'prd-2',
    name: 'Dashboard Analytics Widgets',
    status: Status.InProgress,
    priority: 2,
    dependencies: ['prd-1'],
    content: '# Dashboard Widgets\n\nCreate stat cards and charts...',
    created: '2023-10-26',
    complexity: 'MEDIUM',
    phases: 3
  },
  {
    id: 'prd-3',
    name: 'User Authentication System',
    status: Status.Ready,
    priority: 3,
    dependencies: [],
    content: '# Auth System\n\nImplement JWT based auth...',
    created: '2023-10-27',
    complexity: 'HIGH',
    phases: 5
  },
  {
    id: 'prd-4',
    name: 'Payment Gateway Integration',
    status: Status.Blocked,
    priority: 4,
    dependencies: ['prd-3'],
    content: '# Payment Gateway\n\nStripe integration...',
    created: '2023-10-28',
    complexity: 'HIGH',
    phases: 4
  },
];

export const MOCK_PRS: PullRequest[] = [
  {
    id: 'pr-1',
    number: 101,
    title: 'feat: Add sidebar navigation',
    branch: 'feat/sidebar',
    ciStatus: 'success',
    reviewScore: 95,
    updated: '2 hours ago',
    author: 'dev-bot',
    checks: [
      { name: 'Build', status: 'success' },
      { name: 'Lint', status: 'success' },
      { name: 'Test', status: 'success' },
    ],
    additions: 450,
    deletions: 20,
    filesChanged: 12,
    body: 'Implements the sidebar navigation component.'
  },
  {
    id: 'pr-2',
    number: 102,
    title: 'fix: Login modal z-index',
    branch: 'fix/login-modal',
    ciStatus: 'failure',
    reviewScore: 40,
    updated: '10 mins ago',
    author: 'junior-dev',
    checks: [
      { name: 'Build', status: 'success' },
      { name: 'Lint', status: 'failure' },
    ],
    additions: 5,
    deletions: 2,
    filesChanged: 1,
    body: 'Fixes the issue where login modal was behind the header.'
  },
  {
    id: 'pr-3',
    number: 103,
    title: 'chore: Update deps',
    branch: 'chore/deps',
    ciStatus: 'pending',
    reviewScore: null,
    updated: 'Just now',
    author: 'renovate',
    checks: [
      { name: 'Build', status: 'pending' },
    ],
    additions: 1000,
    deletions: 900,
    filesChanged: 5,
    body: 'Updates all dependencies to latest versions.'
  },
];

export const MOCK_LOGS: string[] = [
  "[2023-10-27 10:00:01] [INFO] Executor started PID: 12345",
  "[2023-10-27 10:00:02] [INFO] Loading configuration...",
  "[2023-10-27 10:00:03] [INFO] Connected to GitHub API",
  "[2023-10-27 10:00:05] [INFO] Fetching PRDs...",
  "[2023-10-27 10:00:06] [WARN] PRD-4 is blocked by missing dependency PRD-3",
  "[2023-10-27 10:00:08] [INFO] Selected PRD-2 for execution",
  "[2023-10-27 10:00:10] [INFO] Generating plan for PRD-2...",
  "[2023-10-27 10:01:15] [ERROR] API Timeout while connecting to Provider",
  "[2023-10-27 10:01:16] [INFO] Retrying connection (1/3)...",
];

export const MOCK_HISTORY: ActionLog[] = [
  { id: '1', action: 'Execute PRD', status: 'Succeeded', duration: '5m 12s', target: 'PRD-1', timestamp: '2 hours ago', logs: [] },
  { id: '2', action: 'Review PRs', status: 'Failed', duration: '1m 05s', target: 'All Open', timestamp: '5 hours ago', logs: [] },
  { id: '3', action: 'Install Cron', status: 'Succeeded', duration: '2s', target: 'System', timestamp: '1 day ago', logs: [] },
];

export const MOCK_NOTIFICATIONS: Notification[] = [
  { id: '1', event: 'run_failed', webhook: 'Slack #alerts', timestamp: '5 hours ago', status: 'sent' },
  { id: '2', event: 'run_succeeded', webhook: 'Discord #general', timestamp: '2 hours ago', status: 'sent' },
];
