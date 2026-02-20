/**
 * SQLite implementation of ISlackDiscussionRepository.
 * Persists Slack discussion records in the `slack_discussions` table.
 */
import 'reflect-metadata';
import Database from "better-sqlite3";
import { ConsensusResult, DiscussionStatus, ISlackDiscussion, TriggerType } from "@/shared/types.js";
import { ISlackDiscussionRepository } from "../interfaces.js";
export declare class SqliteSlackDiscussionRepository implements ISlackDiscussionRepository {
    private readonly _db;
    constructor(db: Database.Database);
    getById(id: string): ISlackDiscussion | null;
    getActive(projectPath: string): ISlackDiscussion[];
    getLatestByTrigger(projectPath: string, triggerType: TriggerType, triggerRef: string): ISlackDiscussion | null;
    create(discussion: Omit<ISlackDiscussion, 'id' | 'createdAt' | 'updatedAt'>): ISlackDiscussion;
    updateStatus(id: string, status: DiscussionStatus, consensusResult?: ConsensusResult): void;
    updateRound(id: string, round: number): void;
    addParticipant(id: string, agentId: string): void;
    close(id: string): void;
}
//# sourceMappingURL=slack-discussion.repository.d.ts.map