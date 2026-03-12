import type { IProviderPreset } from '../../api.js';

export function isGlmPreset(presetId: string | null | undefined, preset: Partial<IProviderPreset> | null | undefined): boolean {
  return Boolean(presetId?.startsWith('glm-') || preset?.model?.startsWith('glm-'));
}

export function isMissingGlmApiKey(
  presetId: string | null | undefined,
  preset: Pick<IProviderPreset, 'model' | 'envVars'> | Partial<IProviderPreset> | null | undefined,
): boolean {
  if (!isGlmPreset(presetId, preset)) return false;
  return !preset?.envVars?.ANTHROPIC_API_KEY?.trim();
}
