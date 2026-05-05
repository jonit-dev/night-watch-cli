import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';

let mockProjectDir: string;

vi.mock('child_process', () => ({
  exec: vi.fn(
    (
      _cmd: string,
      _opts: unknown,
      cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      if (_cmd.includes('git rev-parse')) {
        callback?.(new Error('not a git repo'), { stdout: '', stderr: '' });
        return;
      }
      callback?.(null, { stdout: '', stderr: '' });
    },
  ),
  execFile: vi.fn(),
  execSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('@night-watch/core/utils/crontab.js', () => ({
  getEntries: vi.fn(() => []),
  getProjectEntries: vi.fn(() => []),
  generateMarker: vi.fn((name: string) => `# night-watch-cli: ${name}`),
}));

const originalCwd = process.cwd;
process.cwd = () => mockProjectDir;

import { agentCommand, configCommand, healthCommand, jobCommand } from '@/cli/commands/agent.js';

function registerProgram(): Command {
  const program = new Command();
  program.exitOverride();
  agentCommand(program);
  configCommand(program);
  healthCommand(program);
  jobCommand(program);
  return program;
}

function writeConfig(projectDir: string, value: Record<string, unknown> = {}): void {
  fs.writeFileSync(
    path.join(projectDir, 'night-watch.config.json'),
    JSON.stringify(
      {
        projectName: 'test-project',
        defaultBranch: 'main',
        provider: 'claude',
        reviewerEnabled: true,
        prdDir: 'docs/PRDs/night-watch',
        maxRuntime: 7200,
        reviewerMaxRuntime: 3600,
        queue: { enabled: true },
        ...value,
      },
      null,
      2,
    ),
  );
}

describe('agent manageability commands', () => {
  let tempDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'night-watch-agent-test-'));
    mockProjectDir = tempDir;
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
    writeConfig(tempDir);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    process.exitCode = undefined;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.cwd = originalCwd;
  });

  it('prints agent status as one JSON stdout payload', async () => {
    const program = registerProgram();
    await program.parseAsync(['node', 'test', 'agent', 'status', '--json']);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(payload.schemaVersion).toBe(1);
    expect(payload.status.projectName).toBe('test-project');
    expect(payload.paused.executor).toBe(false);
    expect(payload.queue).toHaveProperty('pending');
    expect(payload.health).toHaveProperty('checks');
  });

  it('gets and sets config dot paths with JSON-only stdout', async () => {
    const program = registerProgram();
    await program.parseAsync([
      'node',
      'test',
      'config',
      'set',
      'reviewerEnabled',
      'false',
      '--json',
    ]);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    const setPayload = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(setPayload).toMatchObject({
      schemaVersion: 1,
      ok: true,
      path: 'reviewerEnabled',
      value: false,
    });

    stdoutSpy.mockClear();
    await program.parseAsync(['node', 'test', 'config', 'get', 'reviewerEnabled', '--json']);
    const getPayload = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(getPayload).toMatchObject({ schemaVersion: 1, path: 'reviewerEnabled', value: false });
  });

  it('fails invalid config paths predictably without stdout in JSON mode', async () => {
    const program = registerProgram();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(
      program.parseAsync(['node', 'test', 'config', 'get', 'missing.path', '--json']),
    ).rejects.toThrow('exit');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload).toMatchObject({
      schemaVersion: 1,
      ok: false,
      error: 'Unknown config path: missing.path',
    });
    exitSpy.mockRestore();
  });

  it('rolls back invalid config values after reload validation', async () => {
    const program = registerProgram();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(
      program.parseAsync([
        'node',
        'test',
        'config',
        'set',
        'reviewerEnabled',
        'not-a-boolean',
        '--json',
      ]),
    ).rejects.toThrow('exit');

    expect(stdoutSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(String(stderrSpy.mock.calls[0][0]));
    expect(payload.error).toBe('Invalid value for config path: reviewerEnabled');
    expect(
      JSON.parse(fs.readFileSync(path.join(tempDir, 'night-watch.config.json'), 'utf-8'))
        .reviewerEnabled,
    ).toBe(true);
    exitSpy.mockRestore();
  });

  it('pauses and resumes jobs through config with JSON output', async () => {
    const program = registerProgram();
    await program.parseAsync(['node', 'test', 'job', 'pause', 'executor', '--json']);

    const pausePayload = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(pausePayload).toMatchObject({
      schemaVersion: 1,
      ok: true,
      job: 'executor',
      paused: true,
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(tempDir, 'night-watch.config.json'), 'utf-8')).pausedJobs
        .executor,
    ).toBe(true);

    stdoutSpy.mockClear();
    await program.parseAsync(['node', 'test', 'job', 'resume', 'executor', '--json']);
    const resumePayload = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(resumePayload).toMatchObject({
      schemaVersion: 1,
      ok: true,
      job: 'executor',
      paused: false,
    });
  });

  it('prints health JSON without noisy stderr output', async () => {
    const program = registerProgram();
    await program.parseAsync(['node', 'test', 'health', '--json']);

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0][0]));
    expect(payload.schemaVersion).toBe(1);
    expect(Array.isArray(payload.checks)).toBe(true);
  });
});
