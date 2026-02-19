#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { reviewCommand } from './commands/review.js';
import { qaCommand } from './commands/qa.js';
import { installCommand } from './commands/install.js';
import { uninstallCommand } from './commands/uninstall.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { prdCommand } from './commands/prd.js';
import { dashboardCommand } from './commands/dashboard.js';
import { doctorCommand } from './commands/doctor.js';
import { serveCommand } from './commands/serve.js';
import { historyCommand } from './commands/history.js';
import { updateCommand } from './commands/update.js';
import { prdStateCommand } from './commands/prd-state.js';
import { retryCommand } from './commands/retry.js';
import { prsCommand } from './commands/prs.js';
import { prdsCommand } from './commands/prds.js';
import { cancelCommand } from './commands/cancel.js';
import { sliceCommand } from './commands/slice.js';
import { createStateCommand } from './commands/state.js';
import { boardCommand } from './commands/board.js';

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

// Register qa command
qaCommand(program);

// Register Phase 5 commands
installCommand(program);
uninstallCommand(program);
statusCommand(program);
logsCommand(program);

// Register prd command
prdCommand(program);

// Register doctor command
doctorCommand(program);

// Register dashboard command
dashboardCommand(program);

// Register serve command
serveCommand(program);

// Register history command (used by bash scripts for cooldown tracking)
historyCommand(program);

// Register update command
updateCommand(program);

// Register prd-state command (used by bash scripts for pending-review state)
prdStateCommand(program);

// Register retry command
retryCommand(program);

// Register prs command
prsCommand(program);

// Register prds command
prdsCommand(program);

// Register cancel command
cancelCommand(program);

// Register slice command (roadmap slicer)
sliceCommand(program);

// Register state command (state management + migration)
program.addCommand(createStateCommand());

// Register board command (GitHub Projects board provider)
boardCommand(program);

program.parse();
