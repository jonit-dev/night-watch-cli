import type { IProviderPreset } from '../api.js';

export const BUILT_IN_PRESET_IDS = ['claude', 'claude-sonnet-4-6', 'claude-opus-4-6', 'codex', 'glm-47', 'glm-5'] as const;

export const BUILT_IN_PRESETS: Record<string, IProviderPreset> = {
  claude: {
    name: 'Claude',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
  },
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'claude-sonnet-4-6',
  },
  'claude-opus-4-6': {
    name: 'Claude Opus 4.6',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'claude-opus-4-6',
  },
  codex: {
    name: 'Codex',
    command: 'codex',
    subcommand: 'exec',
    autoApproveFlag: '--yolo',
    workdirFlag: '-C',
  },
  'glm-47': {
    name: 'GLM-4.7',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'glm-4.7',
    envVars: {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      API_TIMEOUT_MS: '3000000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-4.7',
    },
  },
  'glm-5': {
    name: 'GLM-5',
    command: 'claude',
    promptFlag: '-p',
    autoApproveFlag: '--dangerously-skip-permissions',
    modelFlag: '--model',
    model: 'glm-5',
    envVars: {
      ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic',
      API_TIMEOUT_MS: '3000000',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5',
    },
  },
};
