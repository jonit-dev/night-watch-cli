import * as fs from 'fs';
import * as path from 'path';

import { parseRoadmap } from '../utils/roadmap-parser.js';
import { slugify } from '../utils/prd-utils.js';
import { createFindingFingerprint } from './manager-memory.js';
import type { IManagerFinding, IManagerRunContext } from './manager-types.js';

interface IPrdFileInfo {
  name: string;
  path: string;
  content: string;
}

export interface IManagerAnalysisResult {
  findings: IManagerFinding[];
  roadmapItems: number;
  prds: IPrdFileInfo[];
}

export function analyzeManagerInputs(context: IManagerRunContext): IManagerAnalysisResult {
  const roadmapPath = path.resolve(
    context.projectDir,
    context.config.roadmapScanner?.roadmapPath || 'ROADMAP.md',
  );
  const roadmapContent = fs.existsSync(roadmapPath) ? fs.readFileSync(roadmapPath, 'utf-8') : '';
  const roadmapItems = roadmapContent ? parseRoadmap(roadmapContent) : [];
  const prds = collectPrdFiles(path.resolve(context.projectDir, context.config.prdDir || 'docs/prds'));
  const findings: IManagerFinding[] = [];

  const searchableWork = buildSearchableWork(context.boardIssues.map((issue) => issue.title), prds);
  for (const item of roadmapItems.filter((roadmapItem) => !roadmapItem.checked)) {
    if (searchableWork.has(slugify(item.title))) {
      continue;
    }

    const fingerprint = createFindingFingerprint(['roadmap_gap', item.hash, item.title]);
    findings.push({
      kind: 'roadmap_gap',
      severity: 'warning',
      title: `Roadmap item needs an owner: ${item.title}`,
      body:
        item.description ||
        `The roadmap item "${item.title}" is still unchecked and does not appear to have a matching board issue or PRD.`,
      fingerprint,
      requiresHuman: false,
      source: `roadmap:${item.section}`,
      labels: ['manager', 'roadmap'],
    });
  }

  for (const prd of context.statusSnapshot?.prds ?? []) {
    if (prd.status !== 'blocked') continue;
    const fingerprint = createFindingFingerprint(['blocked_prd', prd.name, ...prd.unmetDependencies]);
    findings.push({
      kind: 'blocked_prd',
      severity: 'blocker',
      title: `Blocked PRD needs human triage: ${prd.name}`,
      body: `PRD "${prd.name}" is blocked by unmet dependencies: ${prd.unmetDependencies.join(', ') || 'unknown'}.`,
      fingerprint,
      requiresHuman: true,
      source: 'status:prds',
      labels: ['manager', 'blocked'],
    });
  }

  const oldestPendingAge = context.queueStatus?.oldestPendingAge;
  if (oldestPendingAge !== null && oldestPendingAge !== undefined && oldestPendingAge > 6 * 60 * 60) {
    const fingerprint = createFindingFingerprint(['stale_queue', String(Math.floor(oldestPendingAge / 3600))]);
    findings.push({
      kind: 'stale_queue',
      severity: 'blocker',
      title: 'Queue has stale pending work',
      body: `The oldest pending queue item has waited ${oldestPendingAge} seconds. This may need human capacity or credentials.`,
      fingerprint,
      requiresHuman: true,
      source: 'queue',
      labels: ['manager', 'queue', 'blocked'],
    });
  }

  if (!fs.existsSync(path.join(context.managerConfig.docsDirectory, 'overview.md'))) {
    const fingerprint = createFindingFingerprint(['missing_manager_doc', context.managerConfig.docsDirectory]);
    findings.push({
      kind: 'missing_manager_doc',
      severity: 'info',
      title: 'Manager overview document is missing',
      body: 'The Manager has not written its generated overview document yet.',
      fingerprint,
      requiresHuman: false,
      source: 'manager-docs',
      labels: ['manager', 'docs'],
    });
  }

  return { findings, roadmapItems: roadmapItems.length, prds };
}

function collectPrdFiles(prdDir: string): IPrdFileInfo[] {
  if (!fs.existsSync(prdDir)) return [];

  const files: IPrdFileInfo[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push({
          name: entry.name.replace(/\.md$/, ''),
          path: fullPath,
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      }
    }
  };

  visit(prdDir);
  return files;
}

function buildSearchableWork(boardTitles: string[], prds: IPrdFileInfo[]): Set<string> {
  const values = new Set<string>();
  for (const title of boardTitles) {
    values.add(slugify(stripManagerPrefix(title)));
  }
  for (const prd of prds) {
    values.add(slugify(prd.name));
    const heading = prd.content
      .split('\n')
      .find((line) => line.startsWith('# '))
      ?.slice(2)
      .trim();
    if (heading) values.add(slugify(heading));
  }
  return values;
}

function stripManagerPrefix(title: string): string {
  let normalized = title.trim();
  if (normalized.toLowerCase().startsWith('[manager] ')) {
    normalized = normalized.slice('[manager] '.length).trim();
  }
  const roadmapPrefix = 'roadmap item needs an owner: ';
  if (normalized.toLowerCase().startsWith(roadmapPrefix)) {
    normalized = normalized.slice(roadmapPrefix.length).trim();
  }
  return normalized;
}
