/**
 * Tests for SqliteAgentPersonaRepository memory lifecycle hooks.
 * Verifies that memory migration and archival are triggered on rename/delete.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { container } from 'tsyringe';

import { MemoryService } from '@/memory/memory-service.js';
import { createDbForDir } from '@/storage/sqlite/client.js';
import { runMigrations } from '@/storage/sqlite/migrations.js';
import { SqliteAgentPersonaRepository } from '@/storage/repositories/sqlite/agent-persona.repository.js';

describe('SqliteAgentPersonaRepository memory hooks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-persona-repo-test-'));
    container.reset();

    const db = createDbForDir(tmpDir);
    runMigrations(db);

    container.registerInstance('Database', db);
    container.registerSingleton(SqliteAgentPersonaRepository);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.reset();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should migrate memory on persona rename', async () => {
    const migrateMemorySpy = vi
      .spyOn(MemoryService.prototype, 'migrateMemory')
      .mockResolvedValue(undefined);

    const repo = container.resolve(SqliteAgentPersonaRepository);
    const persona = repo.create({ name: 'Maya', role: 'Product Manager' });

    repo.update(persona.id, { name: 'Maya-Renamed' });

    // Wait a tick for the fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(migrateMemorySpy).toHaveBeenCalledTimes(1);
    expect(migrateMemorySpy).toHaveBeenCalledWith('Maya', 'Maya-Renamed');
  });

  it('should archive memory on persona delete', async () => {
    const archiveMemorySpy = vi
      .spyOn(MemoryService.prototype, 'archiveMemory')
      .mockResolvedValue(undefined);

    const repo = container.resolve(SqliteAgentPersonaRepository);
    const persona = repo.create({ name: 'Carlos', role: 'Tech Lead' });

    repo.delete(persona.id);

    // Wait a tick for the fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(archiveMemorySpy).toHaveBeenCalledTimes(1);
    expect(archiveMemorySpy).toHaveBeenCalledWith('Carlos');
  });

  it('should not migrate memory when name is unchanged', async () => {
    const migrateMemorySpy = vi
      .spyOn(MemoryService.prototype, 'migrateMemory')
      .mockResolvedValue(undefined);

    const repo = container.resolve(SqliteAgentPersonaRepository);
    const persona = repo.create({ name: 'Priya', role: 'Designer' });

    // Update a different field — name stays the same
    repo.update(persona.id, { role: 'Senior Designer' });

    await new Promise((r) => setTimeout(r, 50));

    expect(migrateMemorySpy).not.toHaveBeenCalled();
  });

  it('should not migrate memory when name field is explicitly provided but unchanged', async () => {
    const migrateMemorySpy = vi
      .spyOn(MemoryService.prototype, 'migrateMemory')
      .mockResolvedValue(undefined);

    const repo = container.resolve(SqliteAgentPersonaRepository);
    const persona = repo.create({ name: 'Dev', role: 'Developer' });

    // Provide the same name explicitly — no migration should occur
    repo.update(persona.id, { name: 'Dev', role: 'Senior Developer' });

    await new Promise((r) => setTimeout(r, 50));

    expect(migrateMemorySpy).not.toHaveBeenCalled();
  });

  it('should handle migrateMemory no-op when source dir missing (real MemoryService)', async () => {
    // Use a real MemoryService pointed at tmpDir — source memory dir does not exist.
    // Verify that migrateMemory completes without throwing.
    const service = new MemoryService(tmpDir);
    await expect(
      service.migrateMemory('NonExistentPersona', 'RenamedPersona'),
    ).resolves.toBeUndefined();
  });
});
