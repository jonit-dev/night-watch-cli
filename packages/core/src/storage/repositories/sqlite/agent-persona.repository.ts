/**
 * SQLite implementation of IAgentPersonaRepository.
 * Persists agent persona entities with JSON-serialized soul/style/skill/modelConfig.
 */

import Database from 'better-sqlite3';
import { inject, injectable } from 'tsyringe';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';
import {
  CreateAgentPersonaInput,
  IAgentModelConfig,
  IAgentPersona,
  IAgentSkill,
  IAgentSoul,
  IAgentStyle,
  UpdateAgentPersonaInput,
} from '@/shared/types.js';
import { MemoryService } from '@/memory/memory-service.js';
import { IAgentPersonaRepository } from '../interfaces.js';
import { DEFAULT_AVATAR_URLS, DEFAULT_PERSONAS } from './agent-persona.defaults.js';

interface IAgentPersonaRow {
  id: string;
  name: string;
  role: string;
  avatar_url: string | null;
  soul_json: string;
  style_json: string;
  skill_json: string;
  model_config_json: string | null;
  system_prompt_override: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

const ENV_KEY_META_KEY = 'agent_persona_env_key';
const ENV_SEEDED_META_KEY = 'agent_personas_seeded';

function defaultSoul(): IAgentSoul {
  return {
    whoIAm: '',
    worldview: [],
    opinions: {},
    expertise: [],
    interests: [],
    tensions: [],
    boundaries: [],
    petPeeves: [],
  };
}

function defaultStyle(): IAgentStyle {
  return {
    voicePrinciples: '',
    sentenceStructure: '',
    tone: '',
    wordsUsed: [],
    wordsAvoided: [],
    emojiUsage: { frequency: 'moderate', favorites: [], contextRules: '' },
    quickReactions: {},
    rhetoricalMoves: [],
    antiPatterns: [],
    goodExamples: [],
    badExamples: [],
  };
}

function defaultSkill(): IAgentSkill {
  return {
    modes: {},
    interpolationRules: '',
    additionalInstructions: [],
  };
}

function mergeSoul(existing: IAgentSoul, patch: Partial<IAgentSoul>): IAgentSoul {
  const merged: IAgentSoul = { ...existing, ...patch };
  if (patch.opinions) {
    merged.opinions = { ...existing.opinions, ...patch.opinions };
  }
  return merged;
}

function mergeStyle(existing: IAgentStyle, patch: Partial<IAgentStyle>): IAgentStyle {
  const merged: IAgentStyle = { ...existing, ...patch };
  if (patch.emojiUsage) {
    merged.emojiUsage = { ...existing.emojiUsage, ...patch.emojiUsage };
  }
  if (patch.quickReactions) {
    merged.quickReactions = { ...existing.quickReactions, ...patch.quickReactions };
  }
  return merged;
}

function mergeSkill(existing: IAgentSkill, patch: Partial<IAgentSkill>): IAgentSkill {
  const merged: IAgentSkill = { ...existing, ...patch };
  if (patch.modes) {
    merged.modes = { ...existing.modes, ...patch.modes };
  }
  return merged;
}

function rowToPersona(row: IAgentPersonaRow, modelConfig: IAgentModelConfig | null): IAgentPersona {
  const soul: IAgentSoul = { ...defaultSoul(), ...JSON.parse(row.soul_json || '{}') };
  const style: IAgentStyle = { ...defaultStyle(), ...JSON.parse(row.style_json || '{}') };
  const skill: IAgentSkill = { ...defaultSkill(), ...JSON.parse(row.skill_json || '{}') };

  return {
    id: row.id,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url,
    soul,
    style,
    skill,
    modelConfig,
    systemPromptOverride: row.system_prompt_override,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@injectable()
export class SqliteAgentPersonaRepository implements IAgentPersonaRepository {
  private readonly db: Database.Database;

  constructor(@inject('Database') db: Database.Database) {
    this.db = db;
  }

  private getOrCreateEnvEncryptionKey(): Buffer {
    const existing = this.db
      .prepare<[string], { value: string }>('SELECT value FROM schema_meta WHERE key = ?')
      .get(ENV_KEY_META_KEY);

    if (existing?.value) {
      const key = Buffer.from(existing.value, 'base64');
      if (key.length === 32) return key;
    }

    const generated = randomBytes(32).toString('base64');
    this.db
      .prepare<[string, string]>(
        `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(ENV_KEY_META_KEY, generated);
    return Buffer.from(generated, 'base64');
  }

  private encryptSecret(value: string): string {
    if (!value || value.startsWith('enc:v1:')) return value;
    const key = this.getOrCreateEnvEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  private decryptSecret(value: string): string {
    if (!value || !value.startsWith('enc:v1:')) return value;

    const parts = value.split(':');
    if (parts.length !== 5) return '';

    try {
      const key = this.getOrCreateEnvEncryptionKey();
      const iv = Buffer.from(parts[2] ?? '', 'base64');
      const tag = Buffer.from(parts[3] ?? '', 'base64');
      const encrypted = Buffer.from(parts[4] ?? '', 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return '';
    }
  }

  private serializeModelConfig(modelConfig: IAgentModelConfig | null): string | null {
    if (!modelConfig) return null;
    const envVars = modelConfig.envVars
      ? Object.fromEntries(
          Object.entries(modelConfig.envVars).map(([key, value]) => [
            key,
            this.encryptSecret(value),
          ]),
        )
      : undefined;
    return JSON.stringify({ ...modelConfig, envVars });
  }

  private deserializeModelConfig(raw: string | null): IAgentModelConfig | null {
    if (!raw) return null;

    const parsed = JSON.parse(raw) as IAgentModelConfig;
    if (!parsed.envVars) return parsed;

    return {
      ...parsed,
      envVars: Object.fromEntries(
        Object.entries(parsed.envVars).map(([key, value]) => [key, this.decryptSecret(value)]),
      ),
    };
  }

  private normalizeIncomingModelConfig(
    incoming: IAgentModelConfig | null,
    existing: IAgentModelConfig | null,
  ): IAgentModelConfig | null {
    if (!incoming) return null;
    if (!incoming.envVars) return incoming;

    const envVars = Object.fromEntries(
      Object.entries(incoming.envVars)
        .map(([key, value]) => {
          if (value === '***') {
            return [key, existing?.envVars?.[key] ?? ''];
          }
          return [key, value];
        })
        .filter(([, value]) => value !== ''),
    );

    return {
      ...incoming,
      envVars: Object.keys(envVars).length > 0 ? envVars : undefined,
    };
  }

  private rowToPersona(row: IAgentPersonaRow): IAgentPersona {
    return rowToPersona(row, this.deserializeModelConfig(row.model_config_json));
  }

  getAll(): IAgentPersona[] {
    const rows = this.db
      .prepare<[], IAgentPersonaRow>('SELECT * FROM agent_personas ORDER BY created_at ASC')
      .all();
    return rows.map((row) => this.rowToPersona(row));
  }

  getById(id: string): IAgentPersona | null {
    const row = this.db
      .prepare<[string], IAgentPersonaRow>('SELECT * FROM agent_personas WHERE id = ?')
      .get(id);
    return row ? this.rowToPersona(row) : null;
  }

  getActive(): IAgentPersona[] {
    const rows = this.db
      .prepare<
        [],
        IAgentPersonaRow
      >('SELECT * FROM agent_personas WHERE is_active = 1 ORDER BY created_at ASC')
      .all();
    return rows.map((row) => this.rowToPersona(row));
  }

  create(input: CreateAgentPersonaInput): IAgentPersona {
    const id = randomUUID();
    const now = Date.now();
    const soul: IAgentSoul = { ...defaultSoul(), ...input.soul };
    const style: IAgentStyle = { ...defaultStyle(), ...input.style };
    const skill: IAgentSkill = { ...defaultSkill(), ...input.skill };

    this.db
      .prepare<
        [
          string,
          string,
          string,
          string | null,
          string,
          string,
          string,
          string | null,
          string | null,
          number,
          number,
        ]
      >(
        `INSERT INTO agent_personas
         (id, name, role, avatar_url, soul_json, style_json, skill_json, model_config_json, system_prompt_override, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.role,
        input.avatarUrl ?? null,
        JSON.stringify(soul),
        JSON.stringify(style),
        JSON.stringify(skill),
        this.serializeModelConfig(
          this.normalizeIncomingModelConfig(input.modelConfig ?? null, null),
        ),
        input.systemPromptOverride ?? null,
        now,
        now,
      );

    return this.getById(id)!;
  }

  update(id: string, input: UpdateAgentPersonaInput): IAgentPersona {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Agent persona not found: ${id}`);

    const now = Date.now();
    const soul: IAgentSoul = input.soul ? mergeSoul(existing.soul, input.soul) : existing.soul;
    const style: IAgentStyle = input.style
      ? mergeStyle(existing.style, input.style)
      : existing.style;
    const skill: IAgentSkill = input.skill
      ? mergeSkill(existing.skill, input.skill)
      : existing.skill;

    const requestedModelConfig =
      'modelConfig' in input ? (input.modelConfig ?? null) : existing.modelConfig;
    const modelConfig = this.normalizeIncomingModelConfig(
      requestedModelConfig,
      existing.modelConfig,
    );

    const oldName = existing.name;
    const newName = input.name ?? existing.name;

    this.db
      .prepare<
        [
          string,
          string,
          string | null,
          string,
          string,
          string,
          string | null,
          string | null,
          number,
          number,
          string,
        ]
      >(
        `UPDATE agent_personas
         SET name = ?, role = ?, avatar_url = ?,
             soul_json = ?, style_json = ?, skill_json = ?,
             model_config_json = ?, system_prompt_override = ?,
             is_active = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        newName,
        input.role ?? existing.role,
        input.avatarUrl !== undefined ? (input.avatarUrl ?? null) : existing.avatarUrl,
        JSON.stringify(soul),
        JSON.stringify(style),
        JSON.stringify(skill),
        this.serializeModelConfig(modelConfig),
        input.systemPromptOverride !== undefined
          ? (input.systemPromptOverride ?? null)
          : existing.systemPromptOverride,
        (input.isActive !== undefined ? input.isActive : existing.isActive) ? 1 : 0,
        now,
        id,
      );

    if (newName !== oldName) {
      const memoryService = new MemoryService();
      memoryService
        .migrateMemory(oldName, newName)
        .then(() => {
          console.log(`[persona] migrated memory: ${oldName} → ${newName}`);
        })
        .catch((err: unknown) => {
          console.warn(`[persona] memory migration failed: ${String(err)}`);
        });
    }

    return this.getById(id)!;
  }

  delete(id: string): void {
    const persona = this.getById(id);
    this.db.prepare<[string]>('DELETE FROM agent_personas WHERE id = ?').run(id);
    if (persona) {
      const memoryService = new MemoryService();
      memoryService
        .archiveMemory(persona.name)
        .then(() => {
          console.log(`[persona] archived memory for: ${persona.name}`);
        })
        .catch((err: unknown) => {
          console.warn(`[persona] memory archive failed: ${String(err)}`);
        });
    }
  }

  seedDefaultsOnFirstRun(): void {
    const seeded = this.db
      .prepare<[string], { value: string }>('SELECT value FROM schema_meta WHERE key = ?')
      .get(ENV_SEEDED_META_KEY);
    if (seeded?.value === '1') return;

    const countRow = this.db
      .prepare<[], { count: number }>('SELECT COUNT(*) as count FROM agent_personas')
      .get();
    if ((countRow?.count ?? 0) === 0) {
      this.seedDefaults();
    }

    this.db
      .prepare<[string, string]>(
        `INSERT INTO schema_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(ENV_SEEDED_META_KEY, '1');
  }

  seedDefaults(): void {
    for (const persona of DEFAULT_PERSONAS) {
      const existing = this.db
        .prepare<
          [string],
          { id: string; avatar_url: string | null }
        >('SELECT id, avatar_url FROM agent_personas WHERE name = ?')
        .get(persona.name);
      if (!existing) {
        this.create(persona);
      } else if (!existing.avatar_url && persona.avatarUrl) {
        // Patch missing avatar URL for existing personas
        this.db
          .prepare<
            [string, number, string]
          >('UPDATE agent_personas SET avatar_url = ?, updated_at = ? WHERE id = ?')
          .run(persona.avatarUrl, Date.now(), existing.id);
      }
    }
  }

  /**
   * Patch avatar URLs for built-in personas.
   * Replaces null or local-path avatars with the canonical GitHub-hosted URLs.
   * Called on every startup so that upgrades always get the correct URLs.
   */
  patchDefaultAvatarUrls(): void {
    for (const [name, url] of Object.entries(DEFAULT_AVATAR_URLS)) {
      this.db
        .prepare<[string, number, string]>(
          `UPDATE agent_personas SET avatar_url = ?, updated_at = ?
           WHERE name = ? AND (avatar_url IS NULL OR avatar_url LIKE '/avatars/%')`,
        )
        .run(url, Date.now(), name);
    }
  }
}
