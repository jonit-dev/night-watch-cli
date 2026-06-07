import { Command } from 'commander';
import {
  getTelemetryEffectiveState,
  isTelemetryEnvDisabled,
  setTelemetryEnabled,
} from '@night-watch/core';
import { fireTelemetryEvent } from './shared/telemetry.js';

function formatInstallId(installId: string): string {
  return installId.slice(0, 8);
}

function printStatus(): void {
  const state = getTelemetryEffectiveState();
  const status = state.enabled ? 'enabled' : 'disabled';
  console.log(`Telemetry: ${status}`);
  console.log(`Reason: ${state.reason}`);
  console.log(`Config path: ${state.path}`);
  console.log(`Install ID: ${formatInstallId(state.config.installId)}`);
  console.log('Privacy docs: docs/privacy.md');
  console.log('Disable: night-watch telemetry disable');
  console.log('Env opt-outs: NW_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1');
}

export function telemetryCommand(program: Command): void {
  const command = program.command('telemetry').description('Manage anonymous product telemetry');

  command
    .command('status')
    .description('Show telemetry status and opt-out information')
    .action(() => {
      printStatus();
    });

  command
    .command('disable')
    .description('Disable anonymous product telemetry')
    .action(async () => {
      const state = getTelemetryEffectiveState();
      if (state.enabled) {
        fireTelemetryEvent('telemetry_disabled');
      }
      setTelemetryEnabled(false);
      console.log('Telemetry disabled.');
      console.log('You can also set NW_TELEMETRY_DISABLED=1 or DO_NOT_TRACK=1.');
    });

  command
    .command('enable')
    .description('Enable anonymous product telemetry')
    .action(() => {
      setTelemetryEnabled(true);
      const envDisabled = isTelemetryEnvDisabled();
      if (!envDisabled) {
        fireTelemetryEvent('telemetry_enabled');
      }
      console.log('Telemetry enabled.');
      if (envDisabled) {
        console.log(`Currently overridden by ${envDisabled}.`);
      }
    });
}
