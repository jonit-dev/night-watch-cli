/**
 * SQLite implementation of IAgentPersonaRepository.
 * Persists agent persona entities with JSON-serialized soul/style/skill/modelConfig.
 */
import 'reflect-metadata';
import Database from "better-sqlite3";
import { CreateAgentPersonaInput, IAgentPersona, UpdateAgentPersonaInput } from "@/shared/types.js";
import { IAgentPersonaRepository } from "../interfaces.js";
export declare class SqliteAgentPersonaRepository implements IAgentPersonaRepository {
    private readonly _db;
    constructor(db: Database.Database);
    private _getOrCreateEnvEncryptionKey;
    private _encryptSecret;
    private _decryptSecret;
    private _serializeModelConfig;
    private _deserializeModelConfig;
    private _normalizeIncomingModelConfig;
    private _rowToPersona;
    getAll(): IAgentPersona[];
    getById(id: string): IAgentPersona | null;
    getActive(): IAgentPersona[];
    create(input: CreateAgentPersonaInput): IAgentPersona;
    update(id: string, input: UpdateAgentPersonaInput): IAgentPersona;
    delete(id: string): void;
    seedDefaultsOnFirstRun(): void;
    seedDefaults(): void;
    /**
     * Patch avatar URLs for built-in personas.
     * Replaces null or local-path avatars with the canonical GitHub-hosted URLs.
     * Called on every startup so that upgrades always get the correct URLs.
     */
    patchDefaultAvatarUrls(): void;
}
//# sourceMappingURL=agent-persona.repository.d.ts.map