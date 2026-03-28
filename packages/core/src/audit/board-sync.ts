import { BoardColumnName } from '../board/types.js';
import { createBoardProvider } from '../board/factory.js';
import { INightWatchConfig } from '../types.js';
import { createLogger } from '../utils/logger.js';
import { AuditSeverity, IAuditFinding, loadAuditFindings } from './report.js';

const logger = createLogger('audit-sync');

export interface IAuditBoardSyncResult {
  status: 'skipped' | 'success' | 'partial' | 'failed';
  findingsCount: number;
  issuesCreated: number;
  issuesFailed: number;
  targetColumn: BoardColumnName | null;
  summary: string;
}

function humanizeCategory(category: string): string {
  return category.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function severityToPriorityLabel(severity: AuditSeverity): 'P0' | 'P1' | 'P2' {
  switch (severity) {
    case 'critical':
      return 'P0';
    case 'high':
      return 'P1';
    default:
      return 'P2';
  }
}

function truncateTitle(title: string, maxLength = 240): string {
  const normalized = title.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildIssueTitle(finding: IAuditFinding): string {
  return truncateTitle(
    `Audit: ${finding.severity} ${humanizeCategory(finding.category)} in ${finding.location}`,
  );
}

function buildIssueBody(finding: IAuditFinding): string {
  const lines = [
    '## Summary',
    '',
    `Night Watch audit detected a **${finding.severity}** finding in \`${finding.location}\`.`,
    '',
    '## Category',
    '',
    `\`${finding.category}\``,
    '',
    '## Description',
    '',
    finding.description,
    '',
    '## Suggested Fix',
    '',
    finding.suggestedFix,
  ];

  if (finding.snippet) {
    lines.push('', '## Snippet', '', '```', finding.snippet, '```');
  }

  lines.push(
    '',
    '## Source',
    '',
    '- Report: `logs/audit-report.md`',
    `- Finding: ${finding.number}`,
  );

  return lines.join('\n');
}

export async function syncAuditFindingsToBoard(
  config: INightWatchConfig,
  projectDir: string,
): Promise<IAuditBoardSyncResult> {
  const findings = loadAuditFindings(projectDir);
  const targetColumn = config.audit.targetColumn;

  if (findings.length === 0) {
    return {
      status: 'skipped',
      findingsCount: 0,
      issuesCreated: 0,
      issuesFailed: 0,
      targetColumn: null,
      summary: 'no actionable audit findings to sync',
    };
  }

  if (!config.boardProvider.enabled) {
    return {
      status: 'skipped',
      findingsCount: findings.length,
      issuesCreated: 0,
      issuesFailed: 0,
      targetColumn: null,
      summary: `found ${findings.length} actionable audit finding(s); board sync skipped because board provider is disabled`,
    };
  }

  let boardProvider;
  try {
    boardProvider = createBoardProvider(config.boardProvider, projectDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to create board provider for audit sync', { error: message });
    return {
      status: 'failed',
      findingsCount: findings.length,
      issuesCreated: 0,
      issuesFailed: findings.length,
      targetColumn,
      summary: `found ${findings.length} actionable audit finding(s), but board sync failed: ${message}`,
    };
  }

  let created = 0;
  let failed = 0;

  for (const finding of findings) {
    try {
      await boardProvider.createIssue({
        title: buildIssueTitle(finding),
        body: buildIssueBody(finding),
        column: targetColumn,
        labels: [severityToPriorityLabel(finding.severity)],
      });
      created++;
    } catch (err) {
      failed++;
      logger.error('Failed to create board issue for audit finding', {
        finding: finding.number,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (failed === 0) {
    return {
      status: 'success',
      findingsCount: findings.length,
      issuesCreated: created,
      issuesFailed: 0,
      targetColumn,
      summary: `created ${created} audit issue(s) in ${targetColumn}`,
    };
  }

  if (created === 0) {
    return {
      status: 'failed',
      findingsCount: findings.length,
      issuesCreated: 0,
      issuesFailed: failed,
      targetColumn,
      summary: `found ${findings.length} actionable audit finding(s), but failed to create board issue(s)`,
    };
  }

  return {
    status: 'partial',
    findingsCount: findings.length,
    issuesCreated: created,
    issuesFailed: failed,
    targetColumn,
    summary: `created ${created} of ${findings.length} audit issue(s) in ${targetColumn} (${failed} failed)`,
  };
}
