import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFindingFingerprint, isKnownFinding, loadManagerMemory } from '../../manager/manager-memory.js';

describe('manager-memory', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('dedupes findings from markdown memory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manager-memory-'));
    tempDirs.push(tempDir);
    const memoryPath = path.join(tempDir, 'memory.md');
    const fingerprint = createFindingFingerprint(['roadmap_gap', 'ship-api']);
    fs.writeFileSync(memoryPath, `# Memory\n\n- fingerprint: \`${fingerprint}\`\n`, 'utf-8');

    const memory = loadManagerMemory(memoryPath);

    expect(isKnownFinding(memory, fingerprint)).toBe(true);
  });
});
