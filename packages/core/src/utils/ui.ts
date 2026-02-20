/**
 * UI utilities for Night Watch CLI
 * Provides colored output, spinners, and table formatting
 */

import chalk from "chalk";
import ora, { type Ora } from "ora";
import Table from "cli-table3";

/**
 * Print a success message with green check prefix
 */
export function success(msg: string): void {
  console.log(chalk.green("✔"), msg);
}

/**
 * Print an error message with red cross prefix
 */
export function error(msg: string): void {
  console.log(chalk.red("✖"), msg);
}

/**
 * Print a warning message with yellow warning prefix
 */
export function warn(msg: string): void {
  console.log(chalk.yellow("⚠"), msg);
}

/**
 * Print an info message with cyan info prefix
 */
export function info(msg: string): void {
  console.log(chalk.cyan("ℹ"), msg);
}

/**
 * Print a bold section header with underline
 */
export function header(title: string): void {
  const line = "─".repeat(Math.max(40, title.length + 4));
  console.log();
  console.log(chalk.bold(title));
  console.log(chalk.dim(line));
}

/**
 * Print dimmed text for secondary information
 */
export function dim(msg: string): void {
  console.log(chalk.dim(msg));
}

/**
 * Format and print a key-value pair with consistent alignment
 */
export function label(key: string, value: string): void {
  const paddedKey = key.padEnd(18);
  console.log(`  ${chalk.dim(paddedKey)}${value}`);
}

/**
 * Create an ora spinner instance
 */
export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: "dots",
  });
}

/**
 * Create a configured cli-table3 instance with sensible defaults
 */
export function createTable(options?: Table.TableConstructorOptions): Table.Table {
  const defaultOptions: Table.TableConstructorOptions = {
    chars: {
      top: "─",
      "top-mid": "┬",
      "top-left": "┌",
      "top-right": "┐",
      bottom: "─",
      "bottom-mid": "┴",
      "bottom-left": "└",
      "bottom-right": "┘",
      left: "│",
      "left-mid": "├",
      mid: "─",
      "mid-mid": "┼",
      right: "│",
      "right-mid": "┤",
      middle: "│",
    },
    style: {
      "padding-left": 1,
      "padding-right": 1,
      head: ["cyan"],
      border: ["dim"],
    },
  };

  return new Table({ ...defaultOptions, ...options });
}

/**
 * Format status indicator: green running or dim not running
 */
export function formatRunningStatus(running: boolean, pid: number | null): string {
  if (running) {
    return chalk.green(`● Running (PID: ${pid})`);
  }
  if (pid) {
    return chalk.dim(`○ Stale lock (PID: ${pid})`);
  }
  return chalk.dim("○ Not running");
}

/**
 * Format installed status: green installed or yellow not installed
 */
export function formatInstalledStatus(installed: boolean): string {
  if (installed) {
    return chalk.green("✔ Installed");
  }
  return chalk.yellow("⚠ Not installed");
}

/**
 * Print a step message with step number
 */
export function step(current: number, total: number, msg: string): void {
  console.log(chalk.dim(`[${current}/${total}]`), msg);
}
