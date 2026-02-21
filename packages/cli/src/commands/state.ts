/**
 * State command — manage Night Watch persistent state.
 * Provides the `night-watch state migrate` subcommand for migrating
 * legacy JSON state files into the SQLite backend.
 */

import * as os from 'os';
import * as path from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { GLOBAL_CONFIG_DIR, migrateJsonToSqlite } from '@night-watch/core';

export function createStateCommand(): Command {
  const state = new Command('state');
  state.description('Manage Night Watch state');

  state
    .command('migrate')
    .description('Migrate legacy JSON state files to SQLite')
    .option('--dry-run', 'Show what would be migrated without making changes')
    .action((opts: { dryRun?: boolean }) => {
      const nightWatchHome =
        process.env.NIGHT_WATCH_HOME || path.join(os.homedir(), GLOBAL_CONFIG_DIR);

      if (opts.dryRun) {
        console.log(chalk.cyan('Dry-run mode: no changes will be made.\n'));
        console.log(`Legacy JSON files that would be migrated from: ${chalk.bold(nightWatchHome)}`);
        console.log(`  ${path.join(nightWatchHome, 'projects.json')}`);
        console.log(`  ${path.join(nightWatchHome, 'history.json')}`);
        console.log(`  ${path.join(nightWatchHome, 'prd-states.json')}`);
        console.log(`  <project>/<prdDir>/.roadmap-state.json (per project)`);
        console.log(chalk.dim('\nRun without --dry-run to apply the migration.'));
        return;
      }

      console.log(chalk.cyan('Migrating legacy JSON state to SQLite...\n'));

      let result;
      try {
        result = migrateJsonToSqlite(nightWatchHome);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`Migration failed: ${message}`));
        process.exit(1);
      }

      if (result.alreadyMigrated) {
        console.log(chalk.yellow('Migration already completed previously. Nothing to do.'));
        return;
      }

      console.log(chalk.green('Migration complete.\n'));
      console.log(chalk.bold('Summary:'));
      console.log(`  Projects migrated:         ${chalk.cyan(String(result.projectsMigrated))}`);
      console.log(
        `  History records migrated:  ${chalk.cyan(String(result.historyRecordsMigrated))}`,
      );
      console.log(`  PRD states migrated:       ${chalk.cyan(String(result.prdStatesMigrated))}`);
      console.log(
        `  Roadmap states migrated:   ${chalk.cyan(String(result.roadmapStatesMigrated))}`,
      );
      console.log(`\n  Backup directory:          ${chalk.dim(result.backupDir)}`);
    });

  return state;
}
