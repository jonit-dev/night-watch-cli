/**
 * Repository interface contracts for Night Watch CLI storage layer.
 * These interfaces define the API that concrete SQLite implementations must satisfy.
 */

import { IRegistryEntry } from '@/utils/registry.js';
import { IExecutionRecord } from '@/utils/execution-history.js';
import { IPrdStateEntry } from '@/utils/prd-states.js';
import { IRoadmapState } from '@/utils/roadmap-state.js';
import { CreateAgentPersonaInput, IAgentPersona, UpdateAgentPersonaInput } from '@/shared/types.js';

export interface IProjectRegistryRepository {
  getAll(): IRegistryEntry[];
  upsert(entry: IRegistryEntry): void;
  remove(path: string): boolean;
  clear(): void;
}

export interface IExecutionHistoryRepository {
  getRecords(projectPath: string, prdFile: string): IExecutionRecord[];
  addRecord(projectPath: string, prdFile: string, record: IExecutionRecord): void;
  trimRecords(projectPath: string, prdFile: string, maxCount: number): void;
  getAllHistory(): Record<string, Record<string, { records: IExecutionRecord[] }>>;
  replaceAll(history: Record<string, Record<string, { records: IExecutionRecord[] }>>): void;
}

export interface IPrdStateRepository {
  get(projectPath: string, prdName: string): IPrdStateEntry | null;
  getAll(projectPath: string): Record<string, IPrdStateEntry>;
  readAll(): Record<string, Record<string, IPrdStateEntry>>;
  set(projectPath: string, prdName: string, entry: IPrdStateEntry): void;
  delete(projectPath: string, prdName: string): void;
}

export interface IRoadmapStateRepository {
  load(prdDir: string): IRoadmapState | null;
  save(prdDir: string, state: IRoadmapState): void;
}

export interface IAgentPersonaRepository {
  getAll(): IAgentPersona[];
  getById(id: string): IAgentPersona | null;
  getActive(): IAgentPersona[];
  create(input: CreateAgentPersonaInput): IAgentPersona;
  update(id: string, input: UpdateAgentPersonaInput): IAgentPersona;
  delete(id: string): void;
  seedDefaultsOnFirstRun(): void;
  seedDefaults(): void;
  patchDefaultAvatarUrls(): void;
}
