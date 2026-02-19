export type BoardColumnName = "Draft" | "Ready" | "In Progress" | "Review" | "Done";

export const BOARD_COLUMNS: BoardColumnName[] = [
  "Draft", "Ready", "In Progress", "Review", "Done"
];

export interface IBoardInfo {
  id: string;
  title: string;
  url: string;
}

export interface IBoardColumn {
  id: string;
  name: BoardColumnName;
}

export interface IBoardIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  url: string;
  column: BoardColumnName | null;
  labels: string[];
  assignees: string[];
}

export interface ICreateIssueInput {
  title: string;
  body: string;
  column?: BoardColumnName;
  labels?: string[];
}

export interface IBoardProvider {
  /** Create a new project board with lifecycle columns. Returns board info. */
  setupBoard(title: string): Promise<IBoardInfo>;

  /** Get the configured board. Returns null if not set up. */
  getBoard(): Promise<IBoardInfo | null>;

  /** List all columns on the board. */
  getColumns(): Promise<IBoardColumn[]>;

  /** Create a GitHub issue and add it to the board in the specified column. */
  createIssue(input: ICreateIssueInput): Promise<IBoardIssue>;

  /** Get a single issue by number. */
  getIssue(issueNumber: number): Promise<IBoardIssue | null>;

  /** List issues in a specific column, ordered by priority. */
  getIssuesByColumn(column: BoardColumnName): Promise<IBoardIssue[]>;

  /** List all issues on the board. */
  getAllIssues(): Promise<IBoardIssue[]>;

  /** Move an issue to a different column. */
  moveIssue(issueNumber: number, targetColumn: BoardColumnName): Promise<void>;

  /** Close an issue (e.g., when done). */
  closeIssue(issueNumber: number): Promise<void>;

  /** Add a comment to an issue. */
  commentOnIssue(issueNumber: number, body: string): Promise<void>;
}

export type BoardProviderType = "github" | "jira" | "linear";

export interface IBoardProviderConfig {
  enabled: boolean;
  provider: BoardProviderType;
  /** GitHub Projects V2 project number (set after `board setup`) */
  projectNumber?: number;
  /** Repository owner/name (auto-detected from git remote) */
  repo?: string;
}
