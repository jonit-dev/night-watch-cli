import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { GLOBAL_CONFIG_DIR, GLOBAL_NOTIFICATIONS_FILE_NAME } from '../constants.js';
import type { IWebhookConfig } from '../types.js';

export interface IGlobalNotificationsConfig {
  webhook: IWebhookConfig | null;
}

function getGlobalNotificationsPath(): string {
  return path.join(os.homedir(), GLOBAL_CONFIG_DIR, GLOBAL_NOTIFICATIONS_FILE_NAME);
}

export function loadGlobalNotificationsConfig(): IGlobalNotificationsConfig {
  const filePath = getGlobalNotificationsPath();
  try {
    if (!fs.existsSync(filePath)) return { webhook: null };
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as IGlobalNotificationsConfig;
  } catch {
    return { webhook: null };
  }
}

export function saveGlobalNotificationsConfig(config: IGlobalNotificationsConfig): void {
  const filePath = getGlobalNotificationsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}
