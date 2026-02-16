#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { reviewCommand } from './commands/review.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { prdCommand } from './commands/prd.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

const program = new Command();

program
  .name('night-watch')
  .description('Autonomous PRD execution using Claude CLI + cron')
  .version(packageJson.version);

// Register init command
initCommand(program);

// Register run command
runCommand(program);

// Register review command
reviewCommand(program);

// Register Phase 5 commands
installCommand(program);
uninstallCommand(program);
statusCommand(program);
logsCommand(program);

// Register prd command
prdCommand(program);

program.parse();
