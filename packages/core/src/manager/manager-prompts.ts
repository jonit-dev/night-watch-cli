import type { IManagerFinding } from './manager-types.js';

export function buildManagerDraftTitle(finding: IManagerFinding): string {
  return `[Manager] ${finding.title}`;
}

export function buildManagerDraftBody(finding: IManagerFinding): string {
  return [
    '# PRD: Manager Draft',
    '',
    '## 1. Context',
    '',
    finding.body,
    '',
    `Source: ${finding.source}`,
    `Manager fingerprint: \`${finding.fingerprint}\``,
    '',
    '## 2. Proposed Outcome',
    '',
    'Turn this finding into a reviewed, executable PRD or close it with a short rationale.',
    '',
    '## 3. Acceptance Criteria',
    '',
    '- [ ] Confirm the finding is still relevant.',
    '- [ ] Define the implementation scope and ownership.',
    '- [ ] Add or update tests appropriate for the selected implementation.',
    '- [ ] Close this draft when the work is represented by an approved PRD or issue.',
    '',
    '## 4. Manager Notes',
    '',
    `- Kind: ${finding.kind}`,
    `- Severity: ${finding.severity}`,
    `- Requires human input: ${finding.requiresHuman ? 'yes' : 'no'}`,
  ].join('\n');
}
