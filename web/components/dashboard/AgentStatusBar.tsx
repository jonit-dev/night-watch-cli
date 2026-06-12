import React from 'react';
import { Square, FileText, Play, Pin, Activity, Clock, GitBranch } from 'lucide-react';
import { IProcessInfo } from '@/api';
import Modal from '../ui/Modal';

interface IAgentStatusBarProps {
  processes: IProcessInfo[];
  activePrd: string | null;
  onCancelProcess: (type: 'run' | 'review') => void;
  onForceClear: () => void;
  onViewLog: () => void;
  cancellingProcess: 'run' | 'review' | null;
  clearingLock: boolean;
  onTriggerJob: (
    job:
      | 'executor'
      | 'reviewer'
      | 'qa'
      | 'audit'
      | 'optimizer'
      | 'ux'
      | 'planner'
      | 'analytics'
      | 'pr-resolver'
      | 'merger'
      | 'manager',
  ) => void;
  triggeringJob: string | null;
}

interface IAgentConfig {
  name: string;
  displayName: string;
  processName: string;
  description: string;
  details: {
    purpose: string;
    howItWorks: string[];
    bestUsedFor: string[];
  };
  primary: boolean;
  triggerId:
    | 'executor'
    | 'reviewer'
    | 'qa'
    | 'audit'
    | 'optimizer'
    | 'ux'
    | 'planner'
    | 'analytics'
    | 'pr-resolver'
    | 'merger'
    | 'manager';
  cancelType?: 'run' | 'review';
  runningLabel: string;
  idleLabel: string;
}

const PINNED_AGENTS_STORAGE_KEY = 'night-watch.dashboard.pinnedAgents';

const AGENTS: IAgentConfig[] = [
  {
    name: 'executor',
    displayName: 'Executor',
    processName: 'executor',
    description: 'Implements ready PRDs and opens pull requests.',
    details: {
      purpose: 'The Executor is the main implementation agent. It picks up ready PRDs, changes code, runs the requested verification, and opens pull requests for review.',
      howItWorks: [
        'Selects pending PRDs from the configured PRD directory or priority list.',
        'Runs the configured AI provider with Night Watch context, project rules, and job limits.',
        'Writes changes on a Night Watch branch, verifies them, and prepares the PR workflow.',
      ],
      bestUsedFor: [
        'Turning approved specs into code.',
        'Routine implementation work that should happen on a schedule.',
        'Keeping feature delivery moving while review and QA remain separate.',
      ],
    },
    primary: true,
    triggerId: 'executor',
    cancelType: 'run',
    runningLabel: 'Running',
    idleLabel: 'Idle',
  },
  {
    name: 'reviewer',
    displayName: 'Reviewer',
    processName: 'reviewer',
    description: 'Reviews Night Watch pull requests and requests fixes when needed.',
    details: {
      purpose: 'The Reviewer inspects open Night Watch pull requests and decides whether they are ready, need changes, or should be repaired automatically.',
      howItWorks: [
        'Finds PRs that match the configured branch patterns.',
        'Scores the change against the requested behavior and repository standards.',
        'Can request fixes or run a retry loop when the score is below the configured threshold.',
      ],
      bestUsedFor: [
        'Catching implementation drift before merge.',
        'Maintaining a consistent review bar across automated PRs.',
        'Reducing manual review load for routine changes.',
      ],
    },
    primary: true,
    triggerId: 'reviewer',
    cancelType: 'review',
    runningLabel: 'Running',
    idleLabel: 'Idle',
  },
  {
    name: 'qa',
    displayName: 'QA',
    processName: 'qa',
    description: 'Runs automated QA checks and captures test artifacts.',
    details: {
      purpose: 'The QA agent validates pull requests with automated test coverage, especially browser flows and visual evidence when Playwright is enabled.',
      howItWorks: [
        'Finds eligible PR branches and checks whether QA should run.',
        'Generates or runs targeted tests using the configured provider and QA settings.',
        'Stores artifacts such as screenshots or videos when enabled.',
      ],
      bestUsedFor: [
        'Smoke testing UI-heavy changes.',
        'Producing evidence for review before merge.',
        'Validating fixes after reviewer feedback.',
      ],
    },
    primary: true,
    triggerId: 'qa',
    runningLabel: 'Running',
    idleLabel: 'Idle',
  },
  {
    name: 'planner',
    displayName: 'Planner',
    processName: 'planner',
    description: 'Turns roadmap or audit findings into implementation-ready PRDs.',
    details: {
      purpose: 'The Planner converts high-level roadmap items, audit findings, or backlog ideas into PRDs that the Executor can pick up later.',
      howItWorks: [
        'Reads the configured roadmap source and existing PRD state.',
        'Chooses one useful slice of work based on priority settings.',
        'Writes a structured PRD with implementation phases and verification guidance.',
      ],
      bestUsedFor: [
        'Keeping the PRD queue supplied.',
        'Breaking large roadmap items into implementable slices.',
        'Turning discovered work into clear execution tickets.',
      ],
    },
    primary: true,
    triggerId: 'planner',
    runningLabel: 'Writing PRDs',
    idleLabel: 'Idle',
  },
  {
    name: 'manager',
    displayName: 'Manager',
    processName: 'manager',
    description: 'Monitors project health and drafts follow-up work.',
    details: {
      purpose: 'The Manager is the project-health agent. It compares roadmap, board, PRD, logs, and job state to surface missing work or operational drift.',
      howItWorks: [
        'Reads current Night Watch status, queue state, board state, and recent logs.',
        'Looks for stuck work, missing PRDs, documentation gaps, or follow-up needs.',
        'Drafts board issues or summaries depending on the configured output mode.',
      ],
      bestUsedFor: [
        'Periodic project hygiene checks.',
        'Finding gaps between roadmap intent and actual work.',
        'Creating follow-up work without running implementation jobs.',
      ],
    },
    primary: true,
    triggerId: 'manager',
    runningLabel: 'Monitoring',
    idleLabel: 'Idle',
  },
  {
    name: 'auditor',
    displayName: 'Auditor',
    processName: 'audit',
    description: 'Scans code quality and security risks, then creates board issues.',
    details: {
      purpose: 'The Auditor searches the codebase for code quality, architecture, reliability, and security issues that deserve follow-up.',
      howItWorks: [
        'Runs the audit prompt against the repository with configured scope and runtime limits.',
        'Prioritizes findings instead of opening broad, low-signal work.',
        'Can create board issues in the configured target column.',
      ],
      bestUsedFor: [
        'Periodic codebase health sweeps.',
        'Finding high-leverage refactors or security risks.',
        'Feeding the Planner or board with vetted improvement work.',
      ],
    },
    primary: false,
    triggerId: 'audit',
    runningLabel: 'Running',
    idleLabel: 'Idle',
  },
  {
    name: 'optimizer',
    displayName: 'Optimizer',
    processName: 'optimizer',
    description: 'Finds and proves one performance or complexity improvement.',
    details: {
      purpose: 'The Optimizer focuses on one measurable performance or algorithmic complexity improvement at a time.',
      howItWorks: [
        'Scans for promising optimization candidates within the configured target scope.',
        'Inspects a small number of high-confidence findings.',
        'Attempts to prove a before/after signal before preparing a draft PR.',
      ],
      bestUsedFor: [
        'Targeted performance cleanup.',
        'Reducing expensive code paths without broad rewrites.',
        'Making optimization work evidence-driven.',
      ],
    },
    primary: false,
    triggerId: 'optimizer',
    runningLabel: 'Optimizing',
    idleLabel: 'Idle',
  },
  {
    name: 'ux',
    displayName: 'UX',
    processName: 'ux',
    description: 'Inspects product flows and drafts prioritized UX reports.',
    details: {
      purpose: 'The UX agent walks configured product flows and turns usability issues into prioritized reports or board work.',
      howItWorks: [
        'Uses the configured base URL, start URL, and flow list.',
        'Inspects screens and interactions through Playwright when available.',
        'Summarizes actionable issues with severity and recommended fixes.',
      ],
      bestUsedFor: [
        'Regular product flow reviews.',
        'Catching broken or awkward UI states.',
        'Creating design-quality follow-up work.',
      ],
    },
    primary: false,
    triggerId: 'ux',
    runningLabel: 'Inspecting',
    idleLabel: 'Idle',
  },
  {
    name: 'analytics',
    displayName: 'Analytics',
    processName: 'analytics',
    description: 'Analyzes Amplitude data and creates follow-up board issues.',
    details: {
      purpose: 'The Analytics agent turns product analytics data into engineering follow-up when trends or anomalies need attention.',
      howItWorks: [
        'Fetches Amplitude data using configured credentials and lookback window.',
        'Runs an analysis prompt over the retrieved metrics.',
        'Creates board issues for findings that look actionable.',
      ],
      bestUsedFor: [
        'Finding product drops or anomalies.',
        'Connecting usage data to engineering work.',
        'Weekly product-health reviews.',
      ],
    },
    primary: false,
    triggerId: 'analytics',
    runningLabel: 'Running',
    idleLabel: 'Idle',
  },
  {
    name: 'pr-resolver',
    displayName: 'PR Resolver',
    processName: 'pr-resolver',
    description: 'Rebases pull requests and applies requested fixes.',
    details: {
      purpose: 'The PR Resolver keeps pull requests moving by handling stale branches, merge conflicts, and selected review feedback.',
      howItWorks: [
        'Finds eligible open PRs from configured branch patterns.',
        'Attempts rebases and conflict resolution within per-PR limits.',
        'Can use AI conflict or review resolution depending on configuration.',
      ],
      bestUsedFor: [
        'Keeping automated PRs from going stale.',
        'Resolving routine merge conflicts.',
        'Applying follow-up fixes after review.',
      ],
    },
    primary: false,
    triggerId: 'pr-resolver',
    runningLabel: 'Resolving',
    idleLabel: 'Idle',
  },
  {
    name: 'merger',
    displayName: 'Merger',
    processName: 'merger',
    description: 'Merges eligible approved pull requests.',
    details: {
      purpose: 'The Merger closes the loop by merging PRs that meet the configured score, CI, label, and branch requirements.',
      howItWorks: [
        'Finds eligible PRs using configured branch patterns and ready labels.',
        'Checks review score, CI policy, and optional local verification.',
        'Merges with the configured method and per-run limits.',
      ],
      bestUsedFor: [
        'Automating low-risk approved merges.',
        'Clearing ready-to-merge queues on a schedule.',
        'Keeping merge policy explicit and repeatable.',
      ],
    },
    primary: false,
    triggerId: 'merger',
    runningLabel: 'Running',
    idleLabel: 'Idle',
  },
];

const AgentStatusBar: React.FC<IAgentStatusBarProps> = ({
  processes,
  activePrd,
  onCancelProcess,
  onForceClear,
  onViewLog,
  cancellingProcess,
  clearingLock,
  onTriggerJob,
  triggeringJob,
}) => {
  const [showAllAgents, setShowAllAgents] = React.useState(false);
  const [selectedAgent, setSelectedAgent] = React.useState<IAgentConfig | null>(null);
  const [pinnedAgents, setPinnedAgents] = React.useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = window.localStorage.getItem(PINNED_AGENTS_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((agent): agent is string => typeof agent === 'string'));
    } catch {
      return new Set();
    }
  });

  const visibleAgents = showAllAgents
    ? AGENTS
    : AGENTS.filter(agent => agent.primary || pinnedAgents.has(agent.name));
  const getProcess = (processName: string) => processes.find(p => p.name === processName);

  const togglePinnedAgent = (agentName: string) => {
    setPinnedAgents((current) => {
      const next = new Set(current);
      if (next.has(agentName)) {
        next.delete(agentName);
      } else {
        next.add(agentName);
      }

      try {
        window.localStorage.setItem(PINNED_AGENTS_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Local storage is best-effort; pinning still works for the current session.
      }
      return next;
    });
  };

  const truncateText = (text: string, maxLen: number): string => {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 1) + '...';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-200">Agents</h2>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300">
            <input
              type="checkbox"
              checked={showAllAgents}
              onChange={(event) => setShowAllAgents(event.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-950 text-indigo-500 focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-0"
            />
            <span>Show all agents</span>
          </label>
          <button
            onClick={onViewLog}
            className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
          >
            View logs
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${showAllAgents ? 'lg:grid-cols-4 xl:grid-cols-6' : 'lg:grid-cols-5'}`}>
        {visibleAgents.map(agent => {
          const process = getProcess(agent.processName);
          const isRunning = process?.running ?? false;
          const pid = process?.pid;
          const isCancelling = cancellingProcess === agent.cancelType;
          const canCancel = isRunning && agent.cancelType;
          const showForceClear = !isRunning && agent.name === 'executor' && activePrd;
          const isPinned = pinnedAgents.has(agent.name);
          const canPin = !agent.primary;

          const statusInfo = isRunning
            ? pid
              ? `PID: ${pid}`
              : agent.runningLabel
            : agent.idleLabel;

          const prdInfo = isRunning && agent.name === 'executor' && activePrd
            ? truncateText(activePrd, 20)
            : null;

          return (
            <div
              key={agent.name}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedAgent(agent)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setSelectedAgent(agent);
                }
              }}
              title={`${agent.displayName}: ${agent.description}`}
              aria-label={`${agent.displayName}. ${agent.description}`}
              className={`group flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 outline-none transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-950/30 focus:ring-2 focus:ring-indigo-500/40 ${
                isRunning
                  ? 'bg-green-950/30 border-green-800/50 hover:border-green-500/60'
                  : 'bg-slate-950/50 border-slate-800 hover:border-indigo-500/40 hover:bg-slate-900/60'
              }`}
            >
              {/* Status Dot */}
              <div
                className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                  isRunning
                    ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]'
                    : 'bg-slate-700'
                }`}
              />

              {/* Agent Name and Status */}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${isRunning ? 'text-slate-200' : 'text-slate-400'}`}>
                  {agent.displayName}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {prdInfo ? (
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3 flex-shrink-0" />
                      {prdInfo}
                    </span>
                  ) : (
                    statusInfo
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div className="flex flex-shrink-0 items-center gap-0.5">
                {canPin && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      togglePinnedAgent(agent.name);
                    }}
                    className={`p-1 rounded transition-colors ${
                      isPinned
                        ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                        : 'text-slate-600 hover:text-slate-300 hover:bg-white/5'
                    }`}
                    title={`${isPinned ? 'Unpin' : 'Pin'} ${agent.displayName}`}
                    aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${agent.displayName}`}
                  >
                    <Pin className={`h-3.5 w-3.5 ${isPinned ? 'fill-current' : ''}`} />
                  </button>
                )}
                {canCancel && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      if (agent.cancelType) {
                        onCancelProcess(agent.cancelType);
                      }
                    }}
                    disabled={isCancelling}
                    className="p-1 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors disabled:opacity-50"
                    title="Stop process"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                )}
                {showForceClear && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onForceClear();
                    }}
                    disabled={clearingLock}
                    className="p-1 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded transition-colors disabled:opacity-50"
                    title="Force clear stale state"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                )}
                {!canCancel && !showForceClear && isRunning && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onViewLog();
                    }}
                    className="p-1 text-slate-400 hover:text-slate-300 hover:bg-white/5 rounded transition-colors"
                    title="View log"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                )}
                {!isRunning && !showForceClear && (
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onTriggerJob(agent.triggerId);
                    }}
                    disabled={triggeringJob !== null}
                    className="p-1 text-slate-500 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors disabled:opacity-50"
                    title={`Run ${agent.displayName}: ${agent.description}`}
                    aria-label={`Run ${agent.displayName}`}
                  >
                    {triggeringJob === agent.triggerId ? (
                      <div className="h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal
        isOpen={selectedAgent !== null}
        onClose={() => setSelectedAgent(null)}
        title={selectedAgent ? `${selectedAgent.displayName} Agent` : 'Agent'}
      >
        {selectedAgent && (
          <div className="space-y-6">
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-indigo-500/10 p-2 text-indigo-300">
                  <Activity className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-100">What it does</div>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{selectedAgent.details.purpose}</p>
                </div>
              </div>
            </div>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-100">
                <GitBranch className="h-4 w-4 text-slate-500" />
                How it works
              </div>
              <div className="space-y-2">
                {selectedAgent.details.howItWorks.map((item) => (
                  <div key={item} className="rounded-md border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-400">
                    {item}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-100">
                <Clock className="h-4 w-4 text-slate-500" />
                Best used for
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {selectedAgent.details.bestUsedFor.map((item) => (
                  <div key={item} className="rounded-md bg-slate-800/40 px-3 py-2 text-xs leading-5 text-slate-300">
                    {item}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AgentStatusBar;
