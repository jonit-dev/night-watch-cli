import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { container } from 'tsyringe';

import { initContainer, DATABASE_TOKEN } from '@/di/container.js';
import { SqliteAgentPersonaRepository } from '@/storage/repositories/sqlite/agent-persona.repository.js';
import { SqliteExecutionHistoryRepository } from '@/storage/repositories/sqlite/execution-history.repository.js';
import { SqlitePrdStateRepository } from '@/storage/repositories/sqlite/prd-state.repository.js';
import { SqliteProjectRegistryRepository } from '@/storage/repositories/sqlite/project-registry.repository.js';
import { SqliteRoadmapStateRepository } from '@/storage/repositories/sqlite/roadmap-state.repository.js';
import { SqliteSlackDiscussionRepository } from '@/storage/repositories/sqlite/slack-discussion.repository.js';

describe('DI Container', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-di-test-'));
    // Clear the container state before each test so initContainer runs fresh
    container.reset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should initialize container without errors', () => {
    expect(() => initContainer(tmpDir)).not.toThrow();
  });

  it('should register the Database token', () => {
    initContainer(tmpDir);
    expect(container.isRegistered(DATABASE_TOKEN)).toBe(true);
  });

  it('should resolve SqliteAgentPersonaRepository', () => {
    initContainer(tmpDir);
    const repo = container.resolve(SqliteAgentPersonaRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(SqliteAgentPersonaRepository);
  });

  it('should resolve SqliteExecutionHistoryRepository', () => {
    initContainer(tmpDir);
    const repo = container.resolve(SqliteExecutionHistoryRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(SqliteExecutionHistoryRepository);
  });

  it('should resolve SqlitePrdStateRepository', () => {
    initContainer(tmpDir);
    const repo = container.resolve(SqlitePrdStateRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(SqlitePrdStateRepository);
  });

  it('should resolve SqliteProjectRegistryRepository', () => {
    initContainer(tmpDir);
    const repo = container.resolve(SqliteProjectRegistryRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(SqliteProjectRegistryRepository);
  });

  it('should resolve SqliteRoadmapStateRepository', () => {
    initContainer(tmpDir);
    const repo = container.resolve(SqliteRoadmapStateRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(SqliteRoadmapStateRepository);
  });

  it('should resolve SqliteSlackDiscussionRepository', () => {
    initContainer(tmpDir);
    const repo = container.resolve(SqliteSlackDiscussionRepository);
    expect(repo).toBeDefined();
    expect(repo).toBeInstanceOf(SqliteSlackDiscussionRepository);
  });

  it('should be idempotent — calling initContainer twice does not throw', () => {
    initContainer(tmpDir);
    // Second call should detect DATABASE_TOKEN already registered and return early
    expect(() => initContainer(tmpDir)).not.toThrow();
  });
});
