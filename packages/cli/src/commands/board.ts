/**
 * Board command group — manage the PRD tracking board
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  BOARD_COLUMNS,
  CATEGORY_LABELS,
  HORIZON_LABELS,
  INightWatchConfig,
  NIGHT_WATCH_LABELS,
  PRIORITY_LABELS,
  createBoardProvider,
  createTable,
  dim,
  extractCategory,
  extractHorizon,
  extractPriority,
  getUncheckedItems,
  header,
  info,
  isValidCategory,
  isValidHorizon,
  isValidPriority,
  loadConfig,
  parseRoadmap,
  saveConfig,
  sortByPriority,
  success,
  warn,
} from '@night-watch/core';
import type {
  BoardColumnName,
  CategoryLabel,
  HorizonLabel,
  IBoardIssue,
  IBoardProvider,
  IRoadmapItem,
} from '@night-watch/core';
import { findMatchingIssue, getLabelsForSection } from '@night-watch/core';
import chalk from 'chalk';

/** Wrap an async action body so provider errors surface as clean messages. */
async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }
}

/**
 * Return a ready-to-use board provider, or exit with an error if not enabled.
 */
function getProvider(config: INightWatchConfig, cwd: string): IBoardProvider {
  if (config.boardProvider?.enabled === false) {
    console.error(
      'Board provider is disabled. Remove boardProvider.enabled: false from night-watch.config.json to re-enable.',
    );
    process.exit(1);
  }
  const bp = config.boardProvider ?? { enabled: true, provider: 'github' as const };
  return createBoardProvider(bp, cwd);
}

function defaultBoardTitle(cwd: string): string {
  return `${path.basename(cwd)} Night Watch`;
}

/**
 * Ensure the project has a configured board number.
 * If missing, auto-create a board and persist projectNumber to config.
 */
async function ensureBoardConfigured(
  config: INightWatchConfig,
  cwd: string,
  provider: IBoardProvider,
  options?: { quiet?: boolean },
): Promise<void> {
  if (config.boardProvider?.projectNumber) {
    return;
  }

  const title = defaultBoardTitle(cwd);
  if (!options?.quiet) {
    info(`No board configured. Creating "${title}"…`);
  }
  const boardInfo = await provider.setupBoard(title);
  await provider.ensureLabels();

  const result = saveConfig(cwd, {
    boardProvider: {
      ...config.boardProvider,
      enabled: config.boardProvider?.enabled ?? true,
      provider: config.boardProvider?.provider ?? 'github',
      projectNumber: boardInfo.number,
    },
  });
  if (!result.success) {
    throw new Error(`Failed to save config: ${result.error}`);
  }

  if (!options?.quiet) {
    success(`Board configured (#${boardInfo.number})`);
  }
}

/**
 * Prompt the user for a yes/no confirmation via readline.
 * Returns true when the user confirms.
 */
async function confirmPrompt(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

/**
 * Create GitHub labels via `gh label create` (idempotent).
 */
async function createGitHubLabel(
  label: { name: string; description: string; color: string },
  cwd: string,
): Promise<{ created: boolean; skipped: boolean; error?: string }> {
  try {
    execFileSync(
      'gh',
      ['label', 'create', label.name, '--description', label.description, '--color', label.color],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { created: true, skipped: false };
  } catch (err) {
    const output = err instanceof Error ? err.message : String(err);
    // Label already exists - treat as success
    if (output.includes('already exists') || output.includes('Label already exists')) {
      return { created: false, skipped: true };
    }
    return { created: false, skipped: false, error: output };
  }
}

/**
 * Group issues by priority for display.
 */
function groupByPriority(issues: IBoardIssue[]): Map<string, IBoardIssue[]> {
  const groups = new Map<string, IBoardIssue[]>();
  // Initialize with ordered priority groups
  groups.set('P0 — Critical', []);
  groups.set('P1 — High', []);
  groups.set('P2 — Normal', []);
  groups.set('No Priority', []);

  for (const issue of issues) {
    const priority = extractPriority(issue);
    if (priority === 'P0') {
      groups.get('P0 — Critical')!.push(issue);
    } else if (priority === 'P1') {
      groups.get('P1 — High')!.push(issue);
    } else if (priority === 'P2') {
      groups.get('P2 — Normal')!.push(issue);
    } else {
      groups.get('No Priority')!.push(issue);
    }
  }
  return groups;
}

/**
 * Group issues by category for display.
 */
function groupByCategory(issues: IBoardIssue[]): Map<string, IBoardIssue[]> {
  const groups = new Map<string, IBoardIssue[]>();
  // Initialize with all categories
  for (const cat of CATEGORY_LABELS) {
    groups.set(cat, []);
  }
  groups.set('No Category', []);

  for (const issue of issues) {
    const category = extractCategory(issue);
    if (category && groups.has(category)) {
      groups.get(category)!.push(issue);
    } else {
      groups.get('No Category')!.push(issue);
    }
  }
  return groups;
}

/**
 * Register the board command group with the program.
 */
export function boardCommand(program: Command): void {
  const board = program.command('board').description('Manage the PRD tracking board');

  // ---------------------------------------------------------------------------
  // board setup
  // ---------------------------------------------------------------------------
  board
    .command('setup')
    .description('Create the Night Watch project board and persist its number to config')
    .option('--title <title>', 'Board title (default: <repo-folder> Night Watch)')
    .action(async (options: { title?: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);

        // Warn if already configured
        if (config.boardProvider?.projectNumber) {
          warn(`Board already set up (project #${config.boardProvider.projectNumber}).`);
          const confirmed = await confirmPrompt(
            'Re-run setup? This will create a new board. [y/N] ',
          );
          if (!confirmed) {
            dim('Aborted.');
            return;
          }
        }

        const boardTitle = options.title?.trim() || defaultBoardTitle(cwd);
        info(`Creating board "${boardTitle}"…`);
        const boardInfo = await provider.setupBoard(boardTitle);

        // Ensure all Night Watch labels exist in the repo
        info('Ensuring labels…');
        const labelResult = await provider.ensureLabels();
        if (labelResult.created > 0) {
          success(`Created ${labelResult.created} label(s)`);
        }
        if (labelResult.skipped > 0) {
          dim(`${labelResult.skipped} label(s) already existed`);
        }

        // Persist the project number
        const result = saveConfig(cwd, {
          boardProvider: {
            ...config.boardProvider,
            projectNumber: boardInfo.number,
          },
        });

        if (!result.success) {
          console.error(`Failed to save config: ${result.error}`);
          process.exit(1);
        }

        const columns = await provider.getColumns();

        header('Board Created');
        success(`URL: ${boardInfo.url}`);
        info('Columns:');
        for (const col of columns) {
          dim(`  • ${col.name}`);
        }
      }),
    );

  // ---------------------------------------------------------------------------
  // board setup-labels
  // ---------------------------------------------------------------------------
  board
    .command('setup-labels')
    .description('Create Night Watch priority, category, and horizon labels in the GitHub repo')
    .option('--dry-run', 'Show what labels would be created without creating them')
    .action(async (options: { dryRun?: boolean }) =>
      run(async () => {
        const cwd = process.cwd();

        header('Night Watch Labels');

        if (options.dryRun) {
          info('Dry run — showing labels that would be created:');
          for (const label of NIGHT_WATCH_LABELS) {
            console.log(`  ${chalk.cyan(label.name)} (${label.color})`);
            dim(`    ${label.description}`);
          }
          return;
        }

        let created = 0;
        let skipped = 0;
        let failed = 0;

        for (const label of NIGHT_WATCH_LABELS) {
          const result = await createGitHubLabel(label, cwd);
          if (result.created) {
            created++;
            success(`Created label: ${label.name}`);
          } else if (result.skipped) {
            skipped++;
            dim(`Label already exists: ${label.name}`);
          } else {
            failed++;
            console.error(chalk.red(`Failed to create label ${label.name}: ${result.error}`));
          }
        }

        console.log();
        info('Summary:');
        dim(`  Created: ${created}`);
        dim(`  Skipped (already existed): ${skipped}`);
        if (failed > 0) {
          console.error(chalk.red(`  Failed: ${failed}`));
        }
      }),
    );

  // ---------------------------------------------------------------------------
  // board create-prd <title>
  // ---------------------------------------------------------------------------
  board
    .command('create-prd')
    .description('Create a new issue on the board and add it in the Draft column')
    .argument('<title>', 'Issue title')
    .option('--body <text>', 'Issue body text')
    .option('--body-file <path>', 'Read issue body from a file')
    .option('--column <name>', 'Target column (default: Draft)', 'Draft')
    .option('--label <name>', 'Label to apply to the issue')
    .option('--priority <value>', 'Priority label (P0, P1, P2)')
    .option('--category <value>', 'Category label (reliability, quality, product, etc.)')
    .option('--horizon <value>', 'Horizon label (short-term, medium-term, long-term)')
    .action(
      async (
        title: string,
        options: {
          body?: string;
          bodyFile?: string;
          column: string;
          label?: string;
          priority?: string;
          category?: string;
          horizon?: string;
        },
      ) =>
        run(async () => {
          const cwd = process.cwd();
          const config = loadConfig(cwd);
          const provider = getProvider(config, cwd);
          await ensureBoardConfigured(config, cwd, provider);

          // Validate column name
          if (!BOARD_COLUMNS.includes(options.column as BoardColumnName)) {
            console.error(
              `Invalid column "${options.column}". Valid columns: ${BOARD_COLUMNS.join(', ')}`,
            );
            process.exit(1);
          }

          // Validate priority
          if (options.priority && !isValidPriority(options.priority)) {
            console.error(
              `Invalid priority "${options.priority}". Valid values: ${PRIORITY_LABELS.join(', ')}`,
            );
            process.exit(1);
          }

          // Validate category
          if (options.category && !isValidCategory(options.category)) {
            console.error(
              `Invalid category "${options.category}". Valid values: ${CATEGORY_LABELS.join(', ')}`,
            );
            process.exit(1);
          }

          // Validate horizon
          if (options.horizon && !isValidHorizon(options.horizon)) {
            console.error(
              `Invalid horizon "${options.horizon}". Valid values: ${HORIZON_LABELS.join(', ')}`,
            );
            process.exit(1);
          }

          let body = options.body ?? '';
          if (options.bodyFile) {
            const filePath = options.bodyFile;
            if (!fs.existsSync(filePath)) {
              console.error(`File not found: ${filePath}`);
              process.exit(1);
            }
            body = fs.readFileSync(filePath, 'utf-8');
          }

          // Build labels array
          const labels: string[] = [];
          if (options.label) {
            labels.push(options.label);
          }
          if (options.priority) {
            labels.push(options.priority);
          }
          if (options.category) {
            labels.push(options.category);
          }
          if (options.horizon) {
            labels.push(options.horizon);
          }

          const issue = await provider.createIssue({
            title,
            body,
            column: options.column as BoardColumnName,
            labels: labels.length > 0 ? labels : undefined,
          });

          console.log(chalk.green(`Created issue #${issue.number}: ${issue.title}`));
          console.log(chalk.green(`URL: ${issue.url}`));

          // Show applied labels
          if (labels.length > 0) {
            dim(`Labels: ${labels.join(', ')}`);
          }
        }),
    );

  // ---------------------------------------------------------------------------
  // board status
  // ---------------------------------------------------------------------------
  board
    .command('status')
    .description('Show the current state of all issues grouped by column')
    .option('--json', 'Output raw JSON')
    .option('--group-by <field>', 'Group by: priority, category, or column (default: column)')
    .action(async (options: { json: boolean; groupBy?: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider, { quiet: options.json });

        const issues = await provider.getAllIssues();

        if (options.json) {
          console.log(JSON.stringify(issues, null, 2));
          return;
        }

        header('Board Status');

        if (issues.length === 0) {
          dim('No issues found on the board.');
          return;
        }

        const groupBy = options.groupBy ?? 'column';

        if (groupBy === 'priority') {
          // Group by priority
          const grouped = groupByPriority(issues);
          const table = createTable({ head: ['Priority', 'Column', '#', 'Title', 'Category'] });

          for (const [priority, priorityIssues] of grouped) {
            if (priorityIssues.length === 0) continue;
            // Sort issues within priority by issue number
            const sorted = [...priorityIssues].sort((a, b) => a.number - b.number);
            for (const issue of sorted) {
              const category = extractCategory(issue) ?? '';
              table.push([
                priority,
                issue.column ?? '-',
                String(issue.number),
                issue.title,
                category,
              ]);
            }
          }

          console.log(table.toString());

          // Summary per priority
          info('Summary:');
          for (const [priority, priorityIssues] of grouped) {
            if (priorityIssues.length > 0) {
              dim(
                `  ${priority}: ${priorityIssues.length} issue${priorityIssues.length === 1 ? '' : 's'}`,
              );
            }
          }
        } else if (groupBy === 'category') {
          // Group by category
          const grouped = groupByCategory(issues);
          const table = createTable({ head: ['Category', 'Column', '#', 'Title', 'Priority'] });

          for (const [category, categoryIssues] of grouped) {
            if (categoryIssues.length === 0) continue;
            // Sort by priority within category
            const sorted = sortByPriority(categoryIssues);
            for (const issue of sorted) {
              const priority = extractPriority(issue) ?? '';
              table.push([
                category,
                issue.column ?? '-',
                String(issue.number),
                issue.title,
                priority,
              ]);
            }
          }

          console.log(table.toString());

          // Summary per category
          info('Summary:');
          for (const [category, categoryIssues] of grouped) {
            if (categoryIssues.length > 0) {
              dim(
                `  ${category}: ${categoryIssues.length} issue${categoryIssues.length === 1 ? '' : 's'}`,
              );
            }
          }
        } else {
          // Default: group by column (with priority and category columns)
          const grouped: Record<string, typeof issues> = {};
          for (const issue of issues) {
            const col = issue.column ?? 'Uncategorised';
            if (!grouped[col]) grouped[col] = [];
            grouped[col].push(issue);
          }

          const table = createTable({ head: ['Column', '#', 'Title', 'Priority', 'Category'] });

          for (const [col, colIssues] of Object.entries(grouped)) {
            // Sort by priority within column
            const sorted = sortByPriority(colIssues);
            for (const issue of sorted) {
              const priority = extractPriority(issue) ?? '';
              const category = extractCategory(issue) ?? '';
              table.push([col, String(issue.number), issue.title, priority, category]);
            }
          }

          console.log(table.toString());

          // Summary per column
          info('Summary:');
          for (const [col, colIssues] of Object.entries(grouped)) {
            dim(`  ${col}: ${colIssues.length} issue${colIssues.length === 1 ? '' : 's'}`);
          }
        }

        dim(`  Total: ${issues.length}`);
      }),
    );

  // ---------------------------------------------------------------------------
  // board next-issue
  // ---------------------------------------------------------------------------
  board
    .command('next-issue')
    .description('Return the next issue from a column (default: Ready), sorted by priority')
    .option('--column <name>', 'Column to fetch from', 'Ready')
    .option('--json', 'Output full issue JSON (for agent consumption)')
    .action(async (options: { column: string; json: boolean }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider, { quiet: options.json });

        const issues = await provider.getIssuesByColumn(options.column as BoardColumnName);

        if (issues.length === 0) {
          if (options.json) {
            return;
          }
          console.log(`No issues found in ${options.column}`);
          return;
        }

        // Sort by priority (P0 > P1 > P2 > unlabeled), then by issue number
        const sorted = sortByPriority(issues).sort((a, b) => {
          const aPriority = extractPriority(a);
          const bPriority = extractPriority(b);
          const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
          const aOrder = aPriority ? priorityOrder[aPriority] : 99;
          const bOrder = bPriority ? priorityOrder[bPriority] : 99;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.number - b.number; // Tie-breaker: issue number ascending
        });

        const issue = sorted[0];

        if (options.json) {
          console.log(JSON.stringify(issue, null, 2));
          return;
        }

        // Display with priority and category info
        const priority = extractPriority(issue);
        const category = extractCategory(issue);
        const horizon = extractHorizon(issue);

        console.log(`#${issue.number} ${issue.title}`);
        if (priority || category || horizon) {
          const labels = [priority, category, horizon].filter(Boolean);
          dim(`Labels: ${labels.join(', ')}`);
        }
        if (issue.body) {
          const preview = issue.body.slice(0, 200);
          const suffix = issue.body.length > 200 ? '…' : '';
          dim(preview + suffix);
        }
      }),
    );

  // ---------------------------------------------------------------------------
  // board move-issue <number>
  // ---------------------------------------------------------------------------
  board
    .command('move-issue')
    .description('Move an issue to a different column')
    .argument('<number>', 'Issue number')
    .requiredOption('--column <name>', 'Target column name')
    .action(async (number: string, options: { column: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        await provider.moveIssue(parseInt(number, 10), options.column as BoardColumnName);

        success(`Moved issue #${number} to ${options.column}`);
      }),
    );

  // ---------------------------------------------------------------------------
  // board comment <number>
  // ---------------------------------------------------------------------------
  board
    .command('comment')
    .description('Add a comment to an issue')
    .argument('<number>', 'Issue number')
    .requiredOption('--body <text>', 'Comment body text')
    .action(async (number: string, options: { body: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        await provider.commentOnIssue(parseInt(number, 10), options.body);

        success(`Comment added to issue #${number}`);
      }),
    );

  // ---------------------------------------------------------------------------
  // board close-issue <number>
  // ---------------------------------------------------------------------------
  board
    .command('close-issue')
    .description('Close an issue and move it to Done')
    .argument('<number>', 'Issue number')
    .action(async (number: string) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        const issueNumber = parseInt(number, 10);
        await provider.closeIssue(issueNumber);
        await provider.moveIssue(issueNumber, 'Done');

        success(`Closed issue #${number} and moved to Done`);
      }),
    );

  // ---------------------------------------------------------------------------
  // board sync-roadmap
  // ---------------------------------------------------------------------------
  board
    .command('sync-roadmap')
    .description('Sync unchecked items from ROADMAP.md to the board as Draft issues')
    .option('--dry-run', 'Show what would be created without making API calls')
    .option('--update-labels', 'Update labels on existing matching issues')
    .option(
      '--roadmap <path>',
      'Path to ROADMAP.md file (default: ROADMAP.md in current directory)',
    )
    .action(async (options: { dryRun?: boolean; updateLabels?: boolean; roadmap?: string }) =>
      run(async () => {
        const cwd = process.cwd();
        const config = loadConfig(cwd);
        const provider = getProvider(config, cwd);
        await ensureBoardConfigured(config, cwd, provider);

        // Find ROADMAP.md
        const roadmapPath = options.roadmap ?? path.join(cwd, 'ROADMAP.md');
        if (!fs.existsSync(roadmapPath)) {
          console.error(`Roadmap file not found: ${roadmapPath}`);
          process.exit(1);
        }

        const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
        const items = parseRoadmap(roadmapContent);
        const uncheckedItems = getUncheckedItems(items);

        if (uncheckedItems.length === 0) {
          info('No unchecked items found in ROADMAP.md');
          return;
        }

        // Get existing issues for matching
        const existingIssues = await provider.getAllIssues();

        header('Roadmap Sync');

        const toCreate: Array<{
          item: IRoadmapItem;
          category: CategoryLabel;
          horizon: HorizonLabel;
        }> = [];
        const toUpdate: Array<{
          item: IRoadmapItem;
          issue: IBoardIssue;
          category: CategoryLabel;
          horizon: HorizonLabel;
        }> = [];
        const skipped: Array<{ item: IRoadmapItem; reason: string }> = [];

        for (const item of uncheckedItems) {
          const labelMapping = getLabelsForSection(item.section);

          if (!labelMapping) {
            skipped.push({ item, reason: 'No section-to-label mapping found' });
            continue;
          }

          const { category, horizon } = labelMapping;
          const existingIssue = findMatchingIssue(item.title, existingIssues, 0.8);

          if (existingIssue) {
            if (options.updateLabels) {
              // Check if labels need updating
              const hasCategory = existingIssue.labels.includes(category);
              const hasHorizon = existingIssue.labels.includes(horizon);
              if (!hasCategory || !hasHorizon) {
                toUpdate.push({ item, issue: existingIssue, category, horizon });
              } else {
                skipped.push({
                  item,
                  reason: `Already exists with correct labels: #${existingIssue.number}`,
                });
              }
            } else {
              skipped.push({ item, reason: `Already exists: #${existingIssue.number}` });
            }
          } else {
            toCreate.push({ item, category, horizon });
          }
        }

        if (options.dryRun) {
          info('Dry run — showing what would happen:');
          console.log();

          if (toCreate.length > 0) {
            console.log(chalk.cyan('Would create:'));
            for (const { item, category, horizon } of toCreate) {
              dim(`  • ${item.title}`);
              dim(`    Section: ${item.section}`);
              dim(`    Labels: ${category}, ${horizon}`);
            }
          }

          if (toUpdate.length > 0) {
            console.log();
            console.log(chalk.yellow('Would update labels:'));
            for (const { item, issue, category, horizon } of toUpdate) {
              dim(`  • #${issue.number}: ${item.title}`);
              dim(`    Labels to add: ${category}, ${horizon}`);
            }
          }

          if (skipped.length > 0) {
            console.log();
            console.log(chalk.gray('Skipped:'));
            for (const { item, reason } of skipped) {
              dim(`  • ${item.title} — ${reason}`);
            }
          }

          console.log();
          info('Summary:');
          dim(`  Would create: ${toCreate.length}`);
          dim(`  Would update: ${toUpdate.length}`);
          dim(`  Skipped: ${skipped.length}`);
          return;
        }

        // Create issues
        let created = 0;
        let updated = 0;
        let failed = 0;

        for (const { item, category, horizon } of toCreate) {
          try {
            const issue = await provider.createIssue({
              title: item.title,
              body: item.description || `Imported from ROADMAP.md section: ${item.section}`,
              column: 'Draft',
              labels: [category, horizon],
            });
            created++;
            success(`Created #${issue.number}: ${item.title}`);
          } catch (err) {
            failed++;
            console.error(chalk.red(`Failed to create "${item.title}": ${(err as Error).message}`));
          }
        }

        // Update labels on existing issues
        for (const { item, issue, category, horizon } of toUpdate) {
          try {
            // Add labels via gh CLI
            const labelsToAdd = [category, horizon].filter((l) => !issue.labels.includes(l));
            if (labelsToAdd.length > 0) {
              execFileSync(
                'gh',
                ['issue', 'edit', String(issue.number), '--add-label', labelsToAdd.join(',')],
                { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
              );
            }
            updated++;
            success(`Updated labels on #${issue.number}: ${item.title}`);
          } catch (err) {
            failed++;
            console.error(
              chalk.red(`Failed to update #${issue.number}: ${(err as Error).message}`),
            );
          }
        }

        console.log();
        info('Summary:');
        dim(`  Created: ${created}`);
        dim(`  Updated: ${updated}`);
        dim(`  Skipped: ${skipped.length}`);
        if (failed > 0) {
          console.error(chalk.red(`  Failed: ${failed}`));
        }
      }),
    );
}
