/**
 * History command — CLI interface to the execution history ledger.
 * Designed for bash script integration (silent stdout, exit-code signaling).
 */

import { Command } from "commander";
import {
  type ExecutionOutcome,
  isInCooldown,
  recordExecution,
} from "../utils/execution-history.js";

const VALID_OUTCOMES: ExecutionOutcome[] = [
  "success",
  "failure",
  "timeout",
  "rate_limited",
];

export function historyCommand(program: Command): void {
  const history = program
    .command("history")
    .description("Manage PRD execution history ledger");

  history
    .command("record <projectDir> <prdFile> <outcome>")
    .description("Record a PRD execution result")
    .option("--exit-code <n>", "Process exit code", "0")
    .option("--attempt <n>", "Attempt number", "1")
    .action(
      (
        projectDir: string,
        prdFile: string,
        outcome: string,
        options: { exitCode: string; attempt: string }
      ) => {
        if (!VALID_OUTCOMES.includes(outcome as ExecutionOutcome)) {
          process.stderr.write(
            `Invalid outcome: ${outcome}. Must be one of: ${VALID_OUTCOMES.join(", ")}\n`
          );
          process.exit(2);
        }

        const exitCode = parseInt(options.exitCode, 10);
        const attempt = parseInt(options.attempt, 10);

        if (isNaN(exitCode)) {
          process.stderr.write(`Invalid exit code: ${options.exitCode}\n`);
          process.exit(2);
        }
        if (isNaN(attempt) || attempt < 1) {
          process.stderr.write(`Invalid attempt: ${options.attempt}\n`);
          process.exit(2);
        }

        recordExecution(
          projectDir,
          prdFile,
          outcome as ExecutionOutcome,
          exitCode,
          attempt
        );
      }
    );

  history
    .command("check <projectDir> <prdFile>")
    .description(
      "Check if a PRD is in cooldown (exit 0 = in cooldown, exit 1 = eligible)"
    )
    .option("--cooldown <seconds>", "Cooldown period in seconds", "7200")
    .action(
      (
        projectDir: string,
        prdFile: string,
        options: { cooldown: string }
      ) => {
        const cooldownPeriod = parseInt(options.cooldown, 10);
        if (isNaN(cooldownPeriod) || cooldownPeriod < 0) {
          process.stderr.write(
            `Invalid cooldown period: ${options.cooldown}\n`
          );
          process.exit(2);
        }

        if (isInCooldown(projectDir, prdFile, cooldownPeriod)) {
          process.exit(0); // in cooldown — caller should skip
        } else {
          process.exit(1); // eligible — caller should proceed
        }
      }
    );
}
