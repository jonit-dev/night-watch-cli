import * as fs from 'fs';
import * as path from 'path';

export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface IAuditFinding {
  number: number;
  severity: AuditSeverity;
  category: string;
  location: string;
  description: string;
  snippet: string;
  suggestedFix: string;
}

export function normalizeAuditSeverity(raw: string): AuditSeverity {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'low') return 'low';
  return 'medium';
}

function extractAuditField(block: string, field: string): string {
  const pattern = new RegExp(
    `- \\*\\*${field}\\*\\*:\\s*([\\s\\S]*?)(?=\\n- \\*\\*|\\n###\\s+Finding\\s+\\d+|$)`,
    'i',
  );
  const match = block.match(pattern);
  if (!match) return '';
  return match[1].replace(/`/g, '').replace(/\r/g, '').trim();
}

export function parseAuditFindings(reportContent: string): IAuditFinding[] {
  const headingRegex = /^###\s+Finding\s+(\d+)\s*$/gm;
  const headings: Array<{ number: number; bodyStart: number; headingStart: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(reportContent)) !== null) {
    const number = parseInt(match[1], 10);
    if (!Number.isNaN(number)) {
      headings.push({
        number,
        bodyStart: headingRegex.lastIndex,
        headingStart: match.index,
      });
    }
  }

  if (headings.length === 0) {
    return [];
  }

  const findings: IAuditFinding[] = [];
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings[i + 1];
    const block = reportContent.slice(
      current.bodyStart,
      next?.headingStart ?? reportContent.length,
    );

    const severityRaw = extractAuditField(block, 'Severity');
    const category = extractAuditField(block, 'Category') || 'uncategorized';
    const location = extractAuditField(block, 'Location') || 'unknown location';
    const description = extractAuditField(block, 'Description') || 'No description provided';
    const snippet = extractAuditField(block, 'Snippet');
    const suggestedFix = extractAuditField(block, 'Suggested Fix') || 'No suggested fix provided';

    findings.push({
      number: current.number,
      severity: normalizeAuditSeverity(severityRaw),
      category,
      location,
      description,
      snippet,
      suggestedFix,
    });
  }

  return findings;
}

export function loadAuditFindings(projectDir: string): IAuditFinding[] {
  const reportPath = path.join(projectDir, 'logs', 'audit-report.md');
  if (!fs.existsSync(reportPath)) {
    return [];
  }

  const reportContent = fs.readFileSync(reportPath, 'utf-8');
  if (!reportContent.trim() || /\bNO_ISSUES_FOUND\b/.test(reportContent)) {
    return [];
  }

  return parseAuditFindings(reportContent);
}
