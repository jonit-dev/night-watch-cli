import {
  getTelemetryEffectiveState,
  isTelemetryEnvDisabled,
  markTelemetryNoticeShown,
} from '@night-watch/core';
import { fireTelemetryEvent, setCliTelemetryVersion } from './commands/shared/telemetry.js';

const NOTICE_LINES = [
  'Night Watch collects anonymous product telemetry to understand usage and improve the CLI.',
  'Telemetry is enabled by default.',
  'Disable anytime with `night-watch telemetry disable`, `NW_TELEMETRY_DISABLED=1`, or `DO_NOT_TRACK=1`.',
  'Collected: CLI version, command/job type, provider, success/failure, duration, exit code, platform, Node major version, board mode, registered project count, and error category.',
  'Never collected: repo names, paths, remotes, branches, PR/issue titles/bodies/URLs/numbers, prompts, provider output, diffs, file paths, usernames/emails, hostnames, env vars, tokens/secrets, or raw stack traces.',
  'Privacy details: docs/privacy.md',
];

function shouldSuppressNotice(argv: string[]): boolean {
  return argv.includes('--json') || argv.includes('-h') || argv.includes('--help');
}

export function bootstrapTelemetry(cliVersion: string, argv = process.argv): void {
  setCliTelemetryVersion(cliVersion);
  if (isTelemetryEnvDisabled() || shouldSuppressNotice(argv)) {
    return;
  }

  try {
    const state = getTelemetryEffectiveState();
    if (!state.enabled || state.config.noticeShownAt) {
      return;
    }

    console.error(NOTICE_LINES.join('\n'));
    markTelemetryNoticeShown();
    fireTelemetryEvent('cli_first_run');
  } catch {
    // Telemetry startup must never block command execution.
  }
}
