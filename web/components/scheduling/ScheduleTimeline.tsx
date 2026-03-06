import { CronExpressionParser } from 'cron-parser';
import {
  addHours,
  differenceInMinutes,
  format,
  max,
  min,
  isAfter,
  isBefore,
  startOfHour,
} from 'date-fns';
import React, { useMemo } from 'react';
import type { INightWatchConfig, IQueueAnalytics, IQueueStatus } from '../../api';


interface ProjectConfig {
  projectId: string;
  config: INightWatchConfig;
}

interface ScheduleTimelineProps {
  configs: ProjectConfig[];
  currentProjectId?: string;
  onEditJob?: (projectId: string, jobType: string) => void;
  queueStatus?: IQueueStatus | null;
  queueAnalytics?: IQueueAnalytics | null;
}

const JOB_TYPES = [
  { id: 'executor', label: 'Executor', color: { bg: 'bg-blue-500', border: 'border-blue-500/60' } },
  { id: 'reviewer', label: 'Reviewer', color: { bg: 'bg-green-500', border: 'border-green-500/60' } },
  { id: 'qa', label: 'QA', color: { bg: 'bg-purple-500', border: 'border-purple-500/60' } },
  { id: 'audit', label: 'Audit', color: { bg: 'bg-orange-500', border: 'border-orange-500/60' } },
  { id: 'slicer', label: 'Planner', color: { bg: 'bg-yellow-500', border: 'border-yellow-500/60' } },
] as const;

// Colors for non-current projects
const PROJECT_ACCENT_COLORS = [
  { bg: 'bg-indigo-400', border: 'border-indigo-400/60' },
  { bg: 'bg-cyan-400', border: 'border-cyan-400/60' },
  { bg: 'bg-rose-400', border: 'border-rose-400/60' },
  { bg: 'bg-violet-400', border: 'border-violet-400/60' },
  { bg: 'bg-amber-400', border: 'border-amber-400/60' },
];

const TIMELINE_PADDING_LEFT = 160;
const TRACK_H = 14;       // px per project sub-track
const BLOCK_H_CURRENT = 10;
const BLOCK_H_OTHER = 7;
const ROW_PAD = 4;

const ScheduleTimeline: React.FC<ScheduleTimelineProps> = ({
  configs,
  currentProjectId,
  onEditJob,
  queueStatus,
  queueAnalytics,
}) => {
  const startTime = useMemo(() => startOfHour(new Date()), []);
  const endTime = useMemo(() => addHours(startTime, 24), [startTime]);
  const executionStartTime = useMemo(() => addHours(startTime, -24), [startTime]);
  const executionEndTime = endTime;

  const timeMarkers = useMemo(() => {
    const markers = [];
    for (let i = 0; i <= 24; i++) {
      markers.push(addHours(startTime, i));
    }
    return markers;
  }, [startTime]);

  const scheduledTasks = useMemo(() => {
    const tasks: Array<{
      projectId: string;
      jobType: typeof JOB_TYPES[number]['id'];
      time: Date;
    }> = [];

    configs.forEach(({ projectId, config }) => {
      const jobSchedules: Record<string, string | null> = {
        executor: config.executorEnabled !== false ? config.cronSchedule : null,
        reviewer: config.reviewerEnabled ? config.reviewerSchedule : null,
        qa: config.qa.enabled ? config.qa.schedule : null,
        audit: config.audit.enabled ? config.audit.schedule : null,
        slicer: config.roadmapScanner.enabled ? config.roadmapScanner.slicerSchedule : null,
      };

      const offset = config.cronScheduleOffset || 0;

      Object.entries(jobSchedules).forEach(([jobType, cronExpr]) => {
        if (!cronExpr) return;
        try {
          const interval = CronExpressionParser.parse(cronExpr, {
            currentDate: startTime,
            endDate: endTime,
            iterator: true,
          });

          while (interval.hasNext()) {
            // cron-parser v5: .next() returns CronDate directly
            const next = interval.next();
            const taskTime = new Date(next.getTime());
            taskTime.setMinutes(taskTime.getMinutes() + offset);

            if (isAfter(taskTime, startTime) && isBefore(taskTime, endTime)) {
              tasks.push({
                projectId,
                jobType: jobType as typeof JOB_TYPES[number]['id'],
                time: taskTime,
              });
            }
          }
        } catch (e) {
          console.error(`Failed to parse cron "${cronExpr}" for ${projectId}/${jobType}`, e);
        }
      });
    });

    return tasks;
  }, [configs, startTime, endTime]);

  const disabledJobs = useMemo(() => {
    const disabled = new Set<string>();
    if (configs.length === 0) return disabled;
    if (configs.every(c => c.config.executorEnabled === false)) disabled.add('executor');
    if (configs.every(c => !c.config.reviewerEnabled)) disabled.add('reviewer');
    if (configs.every(c => !c.config.qa.enabled)) disabled.add('qa');
    if (configs.every(c => !c.config.audit.enabled)) disabled.add('audit');
    if (configs.every(c => !c.config.roadmapScanner.enabled)) disabled.add('slicer');
    return disabled;
  }, [configs]);

  // Assign stable color indices: current project first, then others
  const projectColorMap = useMemo(() => {
    const map = new Map<string, number>();
    let otherIdx = 0;
    configs.forEach((pc) => {
      const isCurrent = pc.projectId === currentProjectId;
      if (!isCurrent) {
        map.set(pc.projectId, otherIdx % PROJECT_ACCENT_COLORS.length);
        otherIdx++;
      }
    });
    return map;
  }, [configs, currentProjectId]);

  const getPosition = (date: Date) => differenceInMinutes(date, startTime);

  const executionTimeMarkers = useMemo(() => {
    const markers = [];
    for (let i = 0; i <= 24; i++) {
      markers.push(addHours(executionStartTime, i));
    }
    return markers;
  }, [executionStartTime]);

  const getExecutionPosition = (date: Date) => {
    const bounded = min([max([date, executionStartTime]), executionEndTime]);
    return differenceInMinutes(bounded, executionStartTime);
  };

  const providerLaneRuns = useMemo(() => {
    const runs = queueAnalytics?.recentRuns ?? [];
    const grouped = new Map<string, Array<{
      id: number;
      jobType: string;
      status: string;
      projectPath: string;
      startedAt: Date;
      finishedAt: Date;
      throttledCount: number;
    }>>();

    for (const run of runs) {
      const providerKey = run.providerKey || 'default';
      const startedAt = new Date(run.startedAt * 1000);
      const finishedAt = run.finishedAt
        ? new Date(run.finishedAt * 1000)
        : new Date();

      if (finishedAt < executionStartTime || startedAt > executionEndTime) {
        continue;
      }

      if (!grouped.has(providerKey)) grouped.set(providerKey, []);
      grouped.get(providerKey)!.push({
        id: run.id,
        jobType: run.jobType,
        status: run.status,
        projectPath: run.projectPath,
        startedAt,
        finishedAt,
        throttledCount: run.throttledCount,
      });
    }

    if (queueStatus?.running) {
      const providerKey = queueStatus.running.providerKey ?? 'default';
      if (!grouped.has(providerKey)) grouped.set(providerKey, []);
      grouped.get(providerKey)!.push({
        id: queueStatus.running.id,
        jobType: queueStatus.running.jobType,
        status: 'running',
        projectPath: queueStatus.running.projectPath,
        startedAt: new Date((queueStatus.running.dispatchedAt ?? queueStatus.running.enqueuedAt) * 1000),
        finishedAt: new Date(),
        throttledCount: 0,
      });
    }

    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([providerKey, runsForProvider]) => ({
        providerKey,
        runs: runsForProvider.sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime()),
      }));
  }, [executionEndTime, executionStartTime, queueAnalytics, queueStatus]);

  const formatProviderLabel = (providerKey: string) =>
    providerKey
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const multiProject = configs.length > 1;

  const gridLines = (
    <div className="absolute inset-0 flex pointer-events-none">
      {timeMarkers.map((_, i) => (
        <div key={i} className="h-full border-l border-slate-800/20" style={{ width: 60 }} />
      ))}
    </div>
  );

  return (
    <div className="w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950/50 flex flex-col">
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-slate-200">Execution Timeline (Next 24h)</h4>
          <p className="text-xs text-slate-500 mt-0.5">Upcoming scheduled runs across projects. Aligned columns = overlap.</p>
        </div>
        {multiProject && (
          <div className="flex flex-wrap gap-2 justify-end max-w-sm">
            <div className="flex items-center gap-1 mr-1">
              <div className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
              <span className="text-[10px] text-slate-400 font-semibold">current</span>
            </div>
            {configs
              .filter(pc => pc.projectId !== currentProjectId)
              .slice(0, 5)
              .map((pc) => {
                const colorIdx = projectColorMap.get(pc.projectId) ?? 0;
                const col = PROJECT_ACCENT_COLORS[colorIdx];
                const shortName = (pc.projectId.split('/').pop() ?? pc.projectId).slice(0, 14);
                return (
                  <div key={pc.projectId} className="flex items-center gap-1">
                    <div className={`w-2 h-2 rounded-full ${col.bg} shrink-0`} />
                    <span className="text-[10px] text-slate-500" title={pc.projectId}>{shortName}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <div className="relative min-w-[1600px]" style={{ width: 24 * 60 + TIMELINE_PADDING_LEFT }}>
          {/* Hour markers */}
          <div className="h-8 border-b border-slate-800 flex">
            <div style={{ width: TIMELINE_PADDING_LEFT }} className="shrink-0 border-r border-slate-800" />
            <div className="flex-1 relative">
              {timeMarkers.map((time, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-slate-800/50 flex flex-col justify-end pb-1 px-1"
                  style={{ left: i * 60 }}
                >
                  <span className="text-[10px] font-mono text-slate-500">
                    {format(time, 'HH:mm')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Job type lanes */}
          <div className="relative">
            {configs.length === 0 && (
              <div className="flex items-center justify-center p-8">
                <p className="text-sm text-slate-500 italic">No project data available for timeline.</p>
              </div>
            )}

            {JOB_TYPES.map((jt) => {
              const isDisabled = disabledJobs.has(jt.id);
              const jobTasks = scheduledTasks.filter(t => t.jobType === jt.id);

              if (!multiProject) {
                // ── Single project: simple centered row ──────────────────
                return (
                  <div key={jt.id} className={`flex border-b border-slate-800/30 ${isDisabled ? 'opacity-40' : ''}`}>
                    <div
                      style={{ width: TIMELINE_PADDING_LEFT }}
                      className="shrink-0 p-3 border-r border-slate-800/50 flex items-center gap-2"
                    >
                      <div className={`w-2 h-2 rounded-full ${jt.color.bg} shrink-0`} />
                      <span className="text-xs font-semibold text-slate-300">{jt.label}</span>
                    </div>
                    <div className="flex-1 relative h-10">
                      {gridLines}
                      {jobTasks.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <span className="text-[10px] text-slate-600 italic">
                            {isDisabled ? 'Disabled' : 'No runs in this window'}
                          </span>
                        </div>
                      ) : (
                        jobTasks.map((task, tIdx) => (
                          <button
                            key={tIdx}
                            type="button"
                            onClick={() => onEditJob?.(task.projectId, task.jobType)}
                            style={{ left: getPosition(task.time) - 3 }}
                            className={`absolute top-1/2 -translate-y-1/2 h-4 w-6 rounded border ${jt.color.bg} ${jt.color.border} opacity-90 hover:opacity-100 hover:scale-110 transition-all cursor-pointer shadow-lg group`}
                            title={`${jt.label} at ${format(task.time, 'HH:mm')}`}
                          >
                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-800 text-white text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-700 z-10">
                              {format(task.time, 'HH:mm')}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              }

              // ── Multi-project: stacked sub-tracks ────────────────────
              const rowHeight = configs.length * TRACK_H + ROW_PAD * 2;

              return (
                <div key={jt.id} className={`flex border-b border-slate-800/30 ${isDisabled ? 'opacity-40' : ''}`}>
                  {/* Left label column */}
                  <div
                    style={{ width: TIMELINE_PADDING_LEFT, height: rowHeight }}
                    className="shrink-0 border-r border-slate-800/50 flex flex-col px-2 py-1"
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${jt.color.bg} shrink-0`} />
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{jt.label}</span>
                    </div>
                    {configs.map((pc) => {
                      const isCurrent = pc.projectId === currentProjectId;
                      const shortName = (pc.projectId.split('/').pop() ?? pc.projectId).slice(0, 14);
                      const colorIdx = projectColorMap.get(pc.projectId) ?? 0;
                      const dotColor = isCurrent ? jt.color.bg : PROJECT_ACCENT_COLORS[colorIdx].bg;
                      return (
                        <div key={pc.projectId} style={{ height: TRACK_H }} className="flex items-center gap-1 overflow-hidden">
                          <div className={`w-1 h-1 rounded-full shrink-0 ${dotColor}`} />
                          <span
                            className={`text-[9px] truncate ${isCurrent ? 'text-slate-200 font-semibold' : 'text-slate-600'}`}
                            title={pc.projectId}
                          >
                            {isCurrent ? `${shortName} ★` : shortName}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Timeline area with per-project sub-tracks */}
                  <div className="flex-1 relative" style={{ height: rowHeight }}>
                    {gridLines}

                    {configs.map((pc, pIdx) => {
                      const isCurrent = pc.projectId === currentProjectId;
                      const projectTasks = jobTasks.filter(t => t.projectId === pc.projectId);
                      const trackTop = ROW_PAD + pIdx * TRACK_H;
                      const blockH = isCurrent ? BLOCK_H_CURRENT : BLOCK_H_OTHER;
                      const blockVertOffset = Math.floor((TRACK_H - blockH) / 2);
                      const colorIdx = projectColorMap.get(pc.projectId) ?? 0;
                      const blockColor = isCurrent
                        ? { bg: jt.color.bg, border: jt.color.border }
                        : PROJECT_ACCENT_COLORS[colorIdx];

                      return (
                        <React.Fragment key={pc.projectId}>
                          {/* Sub-track separator */}
                          {pIdx > 0 && (
                            <div
                              className="absolute left-0 right-0 border-t border-slate-800/20 pointer-events-none"
                              style={{ top: trackTop }}
                            />
                          )}
                          {/* Scheduled blocks */}
                          {projectTasks.map((task, tIdx) => (
                            <button
                              key={tIdx}
                              type="button"
                              onClick={() => onEditJob?.(pc.projectId, task.jobType)}
                              style={{
                                left: getPosition(task.time) - 3,
                                top: trackTop + blockVertOffset,
                                height: blockH,
                              }}
                              className={`absolute w-6 rounded border ${blockColor.bg} ${blockColor.border} ${isCurrent ? 'opacity-90' : 'opacity-50'} hover:opacity-100 hover:z-10 transition-all cursor-pointer group`}
                              title={`${pc.projectId} · ${jt.label} @ ${format(task.time, 'HH:mm')}`}
                            >
                              <div className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-800 text-white text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-700 z-20">
                                {format(task.time, 'HH:mm')}
                              </div>
                            </button>
                          ))}
                        </React.Fragment>
                      );
                    })}

                    {jobTasks.length === 0 && !isDisabled && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <span className="text-[10px] text-slate-700 italic">No runs in this window</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Current time indicator */}
          <div
            className="absolute top-0 bottom-0 w-px bg-rose-500/50 z-10 pointer-events-none"
            style={{ left: TIMELINE_PADDING_LEFT + getPosition(new Date()) }}
          >
            <div className="absolute top-0 h-2 w-2 rounded-full bg-rose-500 -translate-x-1/2" />
          </div>
        </div>
      </div>

      <div className="p-3 bg-slate-900/40 flex items-center gap-4 text-[10px] text-slate-500">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-3 rounded bg-blue-500/50 border border-blue-500" />
          <span>Each block = one scheduled run</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-[1px] h-4 bg-rose-500" />
          <span>Current Time</span>
        </div>
        {multiProject && (
          <div className="flex items-center gap-1.5">
            <span>★ = current project &nbsp;·&nbsp; blocks in same column = scheduling overlap</span>
          </div>
        )}
      </div>

      {/* Provider Execution Lanes — only shown when there are actual recorded runs */}
      {providerLaneRuns.length > 0 && (
        <div className="border-t border-slate-800">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-medium text-slate-200">Recent Execution Runs</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Last 24h of real runs grouped by provider bucket.
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              {queueAnalytics?.recentRuns.length ?? 0} recorded runs
            </div>
          </div>

          <div className="overflow-x-auto custom-scrollbar" data-testid="provider-execution-timeline">
            <div className="relative min-w-[1600px]" style={{ width: 24 * 60 + TIMELINE_PADDING_LEFT }}>
              <div className="h-8 border-b border-slate-800 flex">
                <div style={{ width: TIMELINE_PADDING_LEFT }} className="shrink-0 border-r border-slate-800" />
                <div className="flex-1 relative flex">
                  {executionTimeMarkers.map((time, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l border-slate-800/50 flex flex-col justify-end pb-1 px-1"
                      style={{ left: i * 60 }}
                    >
                      <span className="text-[10px] font-mono text-slate-500">
                        {format(time, 'HH:mm')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative">
                {providerLaneRuns.map(({ providerKey, runs }) => (
                  <div
                    key={providerKey}
                    className="flex border-b border-slate-800/30 min-h-14"
                    data-testid={`provider-execution-lane-${providerKey}`}
                  >
                    <div
                      style={{ width: TIMELINE_PADDING_LEFT }}
                      className="shrink-0 p-3 border-r border-slate-800/50 flex flex-col justify-center"
                    >
                      <span className="text-xs font-semibold text-slate-300 truncate" title={providerKey}>
                        {formatProviderLabel(providerKey)}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono truncate">{providerKey}</span>
                    </div>

                    <div className="flex-1 relative h-14">
                      <div className="absolute inset-0 flex pointer-events-none">
                        {executionTimeMarkers.map((_, i) => (
                          <div key={i} className="h-full border-l border-slate-800/20" style={{ width: 60 }} />
                        ))}
                      </div>

                      {runs.map((run) => {
                        const jt = JOB_TYPES.find((job) => job.id === run.jobType) ?? JOB_TYPES[0];
                        const left = getExecutionPosition(run.startedAt);
                        const right = getExecutionPosition(run.finishedAt);
                        const width = Math.max(right - left, 8);
                        const isRunning = run.status === 'running';
                        const isError = run.status === 'error' || run.status === 'failed' || run.status === 'errored';
                        const colorBg = isRunning ? 'bg-green-500' : isError ? 'bg-red-500' : jt.color.bg;
                        const colorBorder = isRunning ? 'border-green-400/60' : isError ? 'border-red-400/60' : jt.color.border;
                        return (
                          <div
                            key={`${providerKey}-${run.id}-${run.startedAt.getTime()}`}
                            className={`absolute top-1/2 -translate-y-1/2 h-8 rounded border ${colorBg} ${colorBorder} opacity-85 shadow-lg ${isRunning ? 'animate-pulse' : ''}`}
                            style={{ left, width }}
                            title={`${providerKey} • ${jt.label} • ${format(run.startedAt, 'MMM d HH:mm')} • ${run.status}`}
                            data-testid="provider-execution-run"
                          >
                            <div className="h-full px-2 flex items-center justify-between gap-2 text-[10px] text-white/90 overflow-hidden whitespace-nowrap">
                              <span className="font-semibold uppercase tracking-wide">{jt.label}</span>
                              <span className="text-white/70">{run.status}</span>
                              {run.throttledCount > 0 && (
                                <span className="text-yellow-100">throttle {run.throttledCount}x</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="absolute top-0 bottom-0 w-px bg-rose-500/50 z-10 pointer-events-none"
                style={{ left: TIMELINE_PADDING_LEFT + getExecutionPosition(new Date()) }}
              >
                <div className="absolute top-0 h-2 w-2 rounded-full bg-rose-500 -translate-x-1/2" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleTimeline;
