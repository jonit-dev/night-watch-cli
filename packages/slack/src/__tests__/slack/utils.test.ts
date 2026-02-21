import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';

// Mock fs module
vi.mock('node:fs');

// Import after mocking
import { buildCurrentCliInvocation } from '../../utils.js';

describe('buildCurrentCliInvocation', () => {
  const originalArgv = process.argv;
  const originalExecArgv = process.execArgv;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.execArgv = originalExecArgv;
    vi.restoreAllMocks();
  });

  describe('production mode (.js entry)', () => {
    it('should strip tsx flags from execArgv', () => {
      // Simulate production build
      process.argv = [
        '/home/user/.nvm/versions/node/v22.0.0/bin/node',
        '/home/user/night-watch-cli/dist/cli.js',
        'serve',
      ];
      process.execArgv = [];

      const result = buildCurrentCliInvocation(['audit']);
      expect(result).toEqual(['/home/user/night-watch-cli/dist/cli.js', 'audit']);
    });

    it('should filter out tsx preflight and loader flags', () => {
      process.argv = [
        '/home/user/.nvm/versions/node/v22.0.0/bin/node',
        '/home/user/night-watch-cli/dist/cli.js',
        'serve',
      ];
      process.execArgv = [
        '--require',
        '/home/user/night-watch-cli/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///home/user/night-watch-cli/node_modules/tsx/dist/loader.mjs',
      ];

      const result = buildCurrentCliInvocation(['audit']);
      expect(result).toEqual(['/home/user/night-watch-cli/dist/cli.js', 'audit']);
    });
  });

  describe('dev mode (tsx --watch with .ts entry)', () => {
    it('should detect tsx CLI in argv and resolve actual entry from argv[2]', () => {
      // When running: tsx --watch packages/cli/src/cli.ts serve
      // process.argv looks like: [node, tsx/cli.mjs, packages/cli/src/cli.ts, serve]
      const tsxCliPath = '/home/user/night-watch-cli/node_modules/tsx/dist/cli.mjs';
      const cliSrcPath = '/home/user/night-watch-cli/packages/cli/src/cli.ts';

      process.argv = [
        '/home/user/.nvm/versions/node/v22.0.0/bin/node',
        tsxCliPath,
        cliSrcPath,
        'serve',
      ];
      process.execArgv = [
        '--require',
        '/home/user/night-watch-cli/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///home/user/night-watch-cli/node_modules/tsx/dist/loader.mjs',
      ];

      // Mock fs.existsSync to find tsx CLI
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p.toString().includes('tsx/dist/cli.mjs')) return true;
        return false;
      });

      const result = buildCurrentCliInvocation(['audit']);

      // Should use tsx CLI to spawn the .ts entry
      expect(result).toEqual([tsxCliPath, cliSrcPath, 'audit']);
    });

    it('should handle tsx CLI when actual entry is not a .ts file', () => {
      // Edge case: tsx running a .js file
      const tsxCliPath = '/home/user/night-watch-cli/node_modules/tsx/dist/cli.mjs';
      const cliJsPath = '/home/user/night-watch-cli/dist/cli.js';

      process.argv = [
        '/home/user/.nvm/versions/node/v22.0.0/bin/node',
        tsxCliPath,
        cliJsPath,
        'serve',
      ];
      process.execArgv = [
        '--require',
        '/home/user/night-watch-cli/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///home/user/night-watch-cli/node_modules/tsx/dist/loader.mjs',
      ];

      const result = buildCurrentCliInvocation(['audit']);

      // Should still filter out tsx flags and use the .js entry
      expect(result).toEqual([cliJsPath, 'audit']);
    });
  });

  describe('direct tsx run (tsx packages/cli/src/cli.ts serve)', () => {
    it('should handle direct .ts entry without tsx CLI wrapper', () => {
      // When running directly: tsx packages/cli/src/cli.ts serve
      // In some configurations, process.argv[1] IS the .ts file
      const cliSrcPath = '/home/user/night-watch-cli/packages/cli/src/cli.ts';
      const tsxCliPath = '/home/user/night-watch-cli/node_modules/tsx/dist/cli.mjs';

      process.argv = ['/home/user/.nvm/versions/node/v22.0.0/bin/node', cliSrcPath, 'serve'];
      process.execArgv = [
        '--require',
        '/home/user/night-watch-cli/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///home/user/night-watch-cli/node_modules/tsx/dist/loader.mjs',
      ];

      // Mock fs.existsSync to find tsx CLI
      vi.mocked(fs.existsSync).mockImplementation((p: string) => {
        if (p.toString().includes('tsx/dist/cli.mjs')) return true;
        return false;
      });

      const result = buildCurrentCliInvocation(['audit']);

      // Should use tsx CLI to spawn the .ts entry
      expect(result).toEqual([tsxCliPath, cliSrcPath, 'audit']);
    });
  });

  describe('edge cases', () => {
    it('should return null when process.argv[1] is undefined', () => {
      process.argv = ['/home/user/.nvm/versions/node/v22.0.0/bin/node'];
      process.execArgv = [];

      const result = buildCurrentCliInvocation(['audit']);
      expect(result).toBeNull();
    });

    it('should handle tsx CLI not found in dev mode', () => {
      const cliSrcPath = '/home/user/night-watch-cli/packages/cli/src/cli.ts';

      process.argv = ['/home/user/.nvm/versions/node/v22.0.0/bin/node', cliSrcPath, 'serve'];
      process.execArgv = [
        '--require',
        '/home/user/night-watch-cli/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///home/user/night-watch-cli/node_modules/tsx/dist/loader.mjs',
      ];

      // Mock fs.existsSync to NOT find tsx CLI
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = buildCurrentCliInvocation(['audit']);

      // Should fall back to filtering execArgv
      expect(result).toEqual([cliSrcPath, 'audit']);
    });

    it('should handle tsx CLI path without actual entry (argv[2] undefined)', () => {
      // Edge case: tsx CLI in argv[1] but no argv[2]
      const tsxCliPath = '/home/user/night-watch-cli/node_modules/tsx/dist/cli.mjs';

      process.argv = ['/home/user/.nvm/versions/node/v22.0.0/bin/node', tsxCliPath];
      process.execArgv = [
        '--require',
        '/home/user/night-watch-cli/node_modules/tsx/dist/preflight.cjs',
        '--import',
        'file:///home/user/night-watch-cli/node_modules/tsx/dist/loader.mjs',
      ];

      const result = buildCurrentCliInvocation(['audit']);

      // Should fall back to using the tsx CLI path as the entry with filtered flags
      expect(result).toEqual([tsxCliPath, 'audit']);
    });
  });
});
