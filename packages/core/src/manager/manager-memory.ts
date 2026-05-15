import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

import type {
  IManagerCreatedDraft,
  IManagerFinding,
  IManagerMemoryState,
  IManagerRunResult,
  IManagerSkippedFinding,
} from './manager-types.js';

const FINGERPRINT_PATTERN = /fingerprint:\s*`([^`]+)`/g;
const WEEKLY_SUMMARY_PATTERN = /Last weekly summary:\s*([^\n]+)/;

export function createFindingFingerprint(parts: string[]): string {
  const normalized = parts
    .map((part) => part.toLowerCase().trim().replace(/\s+/g, ' '))
    .join('|');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

export function loadManagerMemory(memoryPath: string): IManagerMemoryState {
  if (!fs.existsSync(memoryPath)) {
    return { fingerprints: new Set(), lastWeeklySummaryAt: null, raw: '' };
  }

  const raw = fs.readFileSync(memoryPath, 'utf-8');
  const fingerprints = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = FINGERPRINT_PATTERN.exec(raw)) !== null) {
    fingerprints.add(match[1]);
  }

  const weeklyMatch = raw.match(WEEKLY_SUMMARY_PATTERN);
  const lastWeeklySummaryAt = weeklyMatch ? parseDate(weeklyMatch[1].trim()) : null;

  return { fingerprints, lastWeeklySummaryAt, raw };
}

export function isKnownFinding(memory: IManagerMemoryState, fingerprint: string): boolean {
  return memory.fingerprints.has(fingerprint);
}

export function renderManagerMemory(result: IManagerRunResult, previous: IManagerMemoryState): string {
  const lines: string[] = [
    '# Night Watch Manager Memory',
    '',
    `Last run: ${new Date().toISOString()}`,
    `Last weekly summary: ${getLastWeeklySummary(result, previous)}`,
    '',
    '## Latest Run',
    '',
    `- Findings: ${result.findings.length}`,
    `- Proposed drafts: ${result.proposedDrafts.length}`,
    `- Created drafts: ${result.createdDrafts.length}`,
    `- Skipped duplicates: ${result.skippedFindings.length}`,
    '',
    '## Findings',
    '',
  ];

  for (const finding of result.findings) {
    lines.push(...renderFinding(finding));
  }

  lines.push('## Created Drafts', '');
  for (const draft of result.createdDrafts) {
    lines.push(`- ${draft.title} (#${draft.issue.number}) - fingerprint: \`${draft.fingerprint}\``);
  }
  if (result.createdDrafts.length === 0) {
    lines.push('- None');
  }

  lines.push('', '## Skipped Duplicates', '');
  for (const skipped of result.skippedFindings) {
    lines.push(`- ${skipped.title} (${skipped.reason}) - fingerprint: \`${skipped.fingerprint}\``);
  }
  if (result.skippedFindings.length === 0) {
    lines.push('- None');
  }

  const previousFingerprints = [...previous.fingerprints].filter(
    (fingerprint) => !result.findings.some((finding) => finding.fingerprint === fingerprint),
  );
  if (previousFingerprints.length > 0) {
    lines.push('', '## Previous Fingerprints', '');
    for (const fingerprint of previousFingerprints) {
      lines.push(`- fingerprint: \`${fingerprint}\``);
    }
  }

  return `${lines.join('\n')}\n`;
}

export function writeManagerMemory(memoryPath: string, result: IManagerRunResult, previous: IManagerMemoryState): void {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, renderManagerMemory(result, previous), 'utf-8');
}

function renderFinding(finding: IManagerFinding): string[] {
  return [
    `### ${finding.title}`,
    '',
    `- kind: ${finding.kind}`,
    `- severity: ${finding.severity}`,
    `- source: ${finding.source}`,
    `- fingerprint: \`${finding.fingerprint}\``,
    '',
    finding.body,
    '',
  ];
}

function getLastWeeklySummary(result: IManagerRunResult, previous: IManagerMemoryState): string {
  const weekly = result.notificationDecisions.find(
    (decision) => decision.event === 'manager_weekly_summary' && decision.shouldNotify,
  );
  if (weekly) {
    return new Date().toISOString();
  }
  return previous.lastWeeklySummaryAt?.toISOString() ?? 'never';
}

function parseDate(value: string): Date | null {
  if (value === 'never') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function summarizeCreatedDrafts(drafts: IManagerCreatedDraft[]): string {
  if (drafts.length === 0) return 'No board drafts created.';
  return `${drafts.length} board draft${drafts.length === 1 ? '' : 's'} created.`;
}

export function summarizeSkippedFindings(skipped: IManagerSkippedFinding[]): string {
  if (skipped.length === 0) return 'No duplicate findings skipped.';
  return `${skipped.length} duplicate finding${skipped.length === 1 ? '' : 's'} skipped.`;
}
