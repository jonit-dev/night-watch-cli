import type { IBoardIssue, IBoardProvider } from '../board/types.js';
import { buildManagerDraftBody, buildManagerDraftTitle } from './manager-prompts.js';
import { isKnownFinding } from './manager-memory.js';
import type {
  IManagerCreatedDraft,
  IManagerDraftIssue,
  IManagerFinding,
  IManagerMemoryState,
  IManagerResolvedConfig,
  IManagerSkippedFinding,
} from './manager-types.js';

export function prepareManagerDrafts(input: {
  findings: IManagerFinding[];
  memory: IManagerMemoryState;
  boardIssues: IBoardIssue[];
  managerConfig: IManagerResolvedConfig;
}): { drafts: IManagerDraftIssue[]; skipped: IManagerSkippedFinding[] } {
  const boardTitles = new Set(input.boardIssues.map((issue) => normalizeTitle(issue.title)));
  const drafts: IManagerDraftIssue[] = [];
  const skipped: IManagerSkippedFinding[] = [];

  for (const finding of input.findings) {
    const title = buildManagerDraftTitle(finding);
    if (isKnownFinding(input.memory, finding.fingerprint)) {
      skipped.push({ fingerprint: finding.fingerprint, title, reason: 'memory' });
      continue;
    }

    if (boardTitles.has(normalizeTitle(title)) || boardTitles.has(normalizeTitle(finding.title))) {
      skipped.push({ fingerprint: finding.fingerprint, title, reason: 'board' });
      continue;
    }

    drafts.push({
      title,
      body: buildManagerDraftBody(finding),
      labels: finding.labels,
      column: input.managerConfig.targetColumn,
      fingerprint: finding.fingerprint,
    });
  }

  return { drafts, skipped };
}

export async function createManagerBoardDrafts(input: {
  provider: IBoardProvider | null;
  drafts: IManagerDraftIssue[];
  dryRun: boolean;
  outputMode: string;
}): Promise<IManagerCreatedDraft[]> {
  if (input.dryRun || input.outputMode !== 'board-draft' || !input.provider) {
    return [];
  }

  const created: IManagerCreatedDraft[] = [];
  for (const draft of input.drafts) {
    const issue = await input.provider.createIssue({
      title: draft.title,
      body: draft.body,
      column: draft.column,
      labels: draft.labels,
    });
    created.push({ ...draft, issue });
  }

  return created;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/^\[manager\]\s*/i, '').replace(/\s+/g, ' ').trim();
}
