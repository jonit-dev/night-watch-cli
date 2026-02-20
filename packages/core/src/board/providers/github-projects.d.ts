import { BoardColumnName, IBoardColumn, IBoardInfo, IBoardIssue, IBoardProvider, IBoardProviderConfig, ICreateIssueInput } from "@/board/types.js";
export declare class GitHubProjectsProvider implements IBoardProvider {
    private readonly config;
    private readonly cwd;
    private cachedProjectId;
    private cachedFieldId;
    private cachedOptionIds;
    private cachedOwner;
    private cachedRepositoryId;
    constructor(config: IBoardProviderConfig, cwd: string);
    private getRepo;
    private getRepoParts;
    private getRepoOwnerLogin;
    private getRepoOwner;
    private getRepositoryNodeId;
    private linkProjectToRepository;
    private fetchStatusField;
    /**
     * Fetch and cache the project node ID, Status field ID, and option IDs.
     * Throws if the project cannot be found or has no Status field.
     */
    private ensureProjectCache;
    /** Try user query first, fall back to org query. */
    private fetchProjectNode;
    /**
     * Parse a raw project item node into IBoardIssue, returning null for items
     * that are not issues.
     */
    private parseItem;
    /**
     * Find an existing project by title among the repository owner's first 50 projects.
     * Returns null if not found.
     */
    private findExistingProject;
    /**
     * Ensure the Status field on an existing project has all five Night Watch
     * lifecycle columns, updating it via GraphQL if any are missing.
     */
    private ensureStatusColumns;
    setupBoard(title: string): Promise<IBoardInfo>;
    getBoard(): Promise<IBoardInfo | null>;
    getColumns(): Promise<IBoardColumn[]>;
    createIssue(input: ICreateIssueInput): Promise<IBoardIssue>;
    getIssue(issueNumber: number): Promise<IBoardIssue | null>;
    getIssuesByColumn(column: BoardColumnName): Promise<IBoardIssue[]>;
    getAllIssues(): Promise<IBoardIssue[]>;
    moveIssue(issueNumber: number, targetColumn: BoardColumnName): Promise<void>;
    closeIssue(issueNumber: number): Promise<void>;
    commentOnIssue(issueNumber: number, body: string): Promise<void>;
}
//# sourceMappingURL=github-projects.d.ts.map