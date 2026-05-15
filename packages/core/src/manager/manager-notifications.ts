import type {
  IManagerFinding,
  IManagerMemoryState,
  IManagerNotificationDecision,
  IManagerResolvedConfig,
} from './manager-types.js';

export function prepareManagerNotificationDecisions(input: {
  findings: IManagerFinding[];
  memory: IManagerMemoryState;
  managerConfig: IManagerResolvedConfig;
  now: Date;
}): IManagerNotificationDecision[] {
  const blockers = input.findings.filter((finding) => finding.requiresHuman || finding.severity === 'blocker');
  const decisions: IManagerNotificationDecision[] = [
    {
      event: 'manager_blocked',
      shouldNotify: blockers.length > 0,
      title: blockers.length === 1 ? 'Manager found 1 blocker' : `Manager found ${blockers.length} blockers`,
      body: blockers.map((finding) => `- ${finding.title}`).join('\n') || 'No blockers found.',
      findings: blockers,
    },
  ];

  const weeklyDue = isWeeklySummaryDue(
    input.managerConfig.weeklySummaryEnabled,
    input.managerConfig.weeklySummaryDay,
    input.memory.lastWeeklySummaryAt,
    input.now,
  );
  decisions.push({
    event: 'manager_weekly_summary',
    shouldNotify: weeklyDue,
    title: 'Manager weekly summary',
    body: [
      `Findings: ${input.findings.length}`,
      `Blockers: ${blockers.length}`,
      `Generated at: ${input.now.toISOString()}`,
    ].join('\n'),
    findings: input.findings,
  });

  return decisions;
}

export function isWeeklySummaryDue(
  enabled: boolean,
  configuredDay: number,
  lastWeeklySummaryAt: Date | null,
  now: Date,
): boolean {
  if (!enabled || now.getDay() !== configuredDay) {
    return false;
  }

  if (!lastWeeklySummaryAt) {
    return true;
  }

  const elapsedMs = now.getTime() - lastWeeklySummaryAt.getTime();
  return elapsedMs >= 6.5 * 24 * 60 * 60 * 1000;
}
