import { execFileSync } from "child_process";
import { BOARD_COLUMNS, } from "@/board/types.js";
import { getRepoNwo, getViewerLogin, graphql } from "./github-graphql.js";
// ---------------------------------------------------------------------------
// GitHubProjectsProvider
// ---------------------------------------------------------------------------
export class GitHubProjectsProvider {
    config;
    cwd;
    cachedProjectId = null;
    cachedFieldId = null;
    cachedOptionIds = new Map();
    cachedOwner = null;
    cachedRepositoryId = null;
    constructor(config, cwd) {
        this.config = config;
        this.cwd = cwd;
    }
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    getRepo() {
        return this.config.repo ?? getRepoNwo(this.cwd);
    }
    getRepoParts() {
        const repo = this.getRepo();
        const [owner, name] = repo.split("/");
        if (!owner || !name) {
            throw new Error(`Invalid repository slug: "${repo}". Expected "owner/repo".`);
        }
        return { owner, name };
    }
    getRepoOwnerLogin() {
        return this.getRepoParts().owner;
    }
    getRepoOwner() {
        if (this.cachedOwner && this.cachedRepositoryId) {
            return this.cachedOwner;
        }
        const { owner, name } = this.getRepoParts();
        const data = graphql(`query ResolveRepoOwner($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          id
          owner {
            __typename
            id
            login
          }
        }
      }`, { owner, name }, this.cwd);
        if (!data.repository) {
            throw new Error(`Repository ${owner}/${name} not found.`);
        }
        const ownerNode = data.repository.owner;
        if (!ownerNode ||
            (ownerNode.__typename !== "User" && ownerNode.__typename !== "Organization")) {
            throw new Error(`Failed to resolve repository owner for ${owner}/${name}.`);
        }
        this.cachedRepositoryId = data.repository.id;
        this.cachedOwner = {
            id: ownerNode.id,
            login: ownerNode.login,
            type: ownerNode.__typename,
        };
        return this.cachedOwner;
    }
    getRepositoryNodeId() {
        if (this.cachedRepositoryId) {
            return this.cachedRepositoryId;
        }
        this.getRepoOwner();
        if (!this.cachedRepositoryId) {
            throw new Error(`Failed to resolve repository ID for ${this.getRepo()}.`);
        }
        return this.cachedRepositoryId;
    }
    linkProjectToRepository(projectId) {
        const repositoryId = this.getRepositoryNodeId();
        try {
            graphql(`mutation LinkProjectToRepository($projectId: ID!, $repositoryId: ID!) {
          linkProjectV2ToRepository(input: { projectId: $projectId, repositoryId: $repositoryId }) {
            repository {
              id
            }
          }
        }`, { projectId, repositoryId }, this.cwd);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const normalized = message.toLowerCase();
            if (normalized.includes("already") && normalized.includes("project")) {
                return;
            }
            throw err;
        }
    }
    fetchStatusField(projectId) {
        const fieldData = graphql(`query GetStatusField($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options {
                  id
                  name
                }
              }
            }
          }
        }
      }`, { projectId }, this.cwd);
        const field = fieldData.node?.field;
        if (!field) {
            throw new Error(`Status field not found on project ${projectId}. ` +
                `Run \`night-watch board setup\` to create it.`);
        }
        return {
            fieldId: field.id,
            optionIds: new Map(field.options.map((o) => [o.name, o.id])),
        };
    }
    /**
     * Fetch and cache the project node ID, Status field ID, and option IDs.
     * Throws if the project cannot be found or has no Status field.
     */
    async ensureProjectCache() {
        if (this.cachedProjectId !== null &&
            this.cachedFieldId !== null &&
            this.cachedOptionIds.size > 0) {
            return {
                projectId: this.cachedProjectId,
                fieldId: this.cachedFieldId,
                optionIds: this.cachedOptionIds,
            };
        }
        if (this.cachedProjectId !== null) {
            const statusField = this.fetchStatusField(this.cachedProjectId);
            this.cachedFieldId = statusField.fieldId;
            this.cachedOptionIds = statusField.optionIds;
            return {
                projectId: this.cachedProjectId,
                fieldId: this.cachedFieldId,
                optionIds: this.cachedOptionIds,
            };
        }
        const projectNumber = this.config.projectNumber;
        if (!projectNumber) {
            throw new Error("No projectNumber configured. Run `night-watch board setup` first.");
        }
        const ownerLogins = new Set([this.getRepoOwnerLogin()]);
        try {
            ownerLogins.add(getViewerLogin(this.cwd));
        }
        catch {
            // ignore fallback if viewer lookup fails
        }
        let projectNode = null;
        for (const login of ownerLogins) {
            projectNode = this.fetchProjectNode(login, projectNumber);
            if (projectNode) {
                break;
            }
        }
        if (!projectNode) {
            throw new Error(`GitHub Project #${projectNumber} not found for repository owner "${this.getRepoOwnerLogin()}".`);
        }
        this.cachedProjectId = projectNode.id;
        const statusField = this.fetchStatusField(projectNode.id);
        this.cachedFieldId = statusField.fieldId;
        this.cachedOptionIds = statusField.optionIds;
        return {
            projectId: this.cachedProjectId,
            fieldId: this.cachedFieldId,
            optionIds: this.cachedOptionIds,
        };
    }
    /** Try user query first, fall back to org query. */
    fetchProjectNode(login, projectNumber) {
        try {
            const userData = graphql(`query GetProject($login: String!, $number: Int!) {
          user(login: $login) {
            projectV2(number: $number) {
              id
              number
              title
              url
            }
          }
        }`, { login, number: projectNumber }, this.cwd);
            if (userData.user?.projectV2) {
                return userData.user.projectV2;
            }
        }
        catch {
            // Swallow — try org query next
        }
        try {
            const orgData = graphql(`query GetOrgProject($login: String!, $number: Int!) {
          organization(login: $login) {
            projectV2(number: $number) {
              id
              number
              title
              url
            }
          }
        }`, { login, number: projectNumber }, this.cwd);
            if (orgData.organization?.projectV2) {
                return orgData.organization.projectV2;
            }
        }
        catch {
            // Swallow
        }
        return null;
    }
    /**
     * Parse a raw project item node into IBoardIssue, returning null for items
     * that are not issues.
     */
    parseItem(item) {
        const content = item.content;
        if (!content || content.number === undefined) {
            return null;
        }
        // Find the Status column value from the field values
        let column = null;
        for (const fv of item.fieldValues.nodes) {
            if (fv.field?.name === "Status" && fv.name) {
                const candidate = fv.name;
                if (BOARD_COLUMNS.includes(candidate)) {
                    column = candidate;
                }
            }
        }
        return {
            id: content.id ?? item.id,
            number: content.number,
            title: content.title ?? "",
            body: content.body ?? "",
            url: content.url ?? "",
            column,
            labels: content.labels?.nodes.map((l) => l.name) ?? [],
            assignees: content.assignees?.nodes.map((a) => a.login) ?? [],
        };
    }
    // -------------------------------------------------------------------------
    // IBoardProvider implementation
    // -------------------------------------------------------------------------
    /**
     * Find an existing project by title among the repository owner's first 50 projects.
     * Returns null if not found.
     */
    findExistingProject(owner, title) {
        try {
            if (owner.type === "User") {
                const data = graphql(`query ListUserProjects($login: String!) {
            user(login: $login) {
              projectsV2(first: 50) {
                nodes { id number title url }
              }
            }
          }`, { login: owner.login }, this.cwd);
                return data.user?.projectsV2.nodes.find((p) => p.title === title) ?? null;
            }
            const data = graphql(`query ListOrgProjects($login: String!) {
          organization(login: $login) {
            projectsV2(first: 50) {
              nodes { id number title url }
            }
          }
        }`, { login: owner.login }, this.cwd);
            return data.organization?.projectsV2.nodes.find((p) => p.title === title) ?? null;
        }
        catch {
            return null;
        }
    }
    /**
     * Ensure the Status field on an existing project has all five Night Watch
     * lifecycle columns, updating it via GraphQL if any are missing.
     */
    ensureStatusColumns(projectId) {
        const fieldData = graphql(`query GetStatusField($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            field(name: "Status") {
              ... on ProjectV2SingleSelectField {
                id
                options { id name }
              }
            }
          }
        }
      }`, { projectId }, this.cwd);
        const field = fieldData.node?.field;
        if (!field)
            return;
        const existing = new Set(field.options.map((o) => o.name));
        const required = ["Draft", "Ready", "In Progress", "Review", "Done"];
        const missing = required.filter((n) => !existing.has(n));
        if (missing.length === 0)
            return;
        const colorMap = {
            Draft: "GRAY",
            Ready: "BLUE",
            "In Progress": "YELLOW",
            Review: "ORANGE",
            Done: "GREEN",
        };
        const allOptions = required.map((name) => ({
            name,
            color: colorMap[name],
            description: "",
        }));
        graphql(`mutation UpdateField($fieldId: ID!) {
        updateProjectV2Field(input: {
          fieldId: $fieldId,
          singleSelectOptions: [
            { name: "Draft",       color: GRAY,   description: "" },
            { name: "Ready",       color: BLUE,   description: "" },
            { name: "In Progress", color: YELLOW, description: "" },
            { name: "Review",      color: ORANGE, description: "" },
            { name: "Done",        color: GREEN,  description: "" }
          ]
        }) {
          projectV2Field {
            ... on ProjectV2SingleSelectField {
              id
              options { id name }
            }
          }
        }
      }`, { fieldId: field.id, allOptions }, this.cwd);
    }
    async setupBoard(title) {
        const owner = this.getRepoOwner();
        // Find or create — avoid duplicating boards on re-runs
        const existing = this.findExistingProject(owner, title);
        if (existing) {
            this.cachedProjectId = existing.id;
            this.linkProjectToRepository(existing.id);
            this.ensureStatusColumns(existing.id);
            return { id: existing.id, number: existing.number, title: existing.title, url: existing.url };
        }
        // Create the project
        const createData = graphql(`mutation CreateProject($ownerId: ID!, $title: String!) {
        createProjectV2(input: { ownerId: $ownerId, title: $title }) {
          projectV2 {
            id
            number
            url
            title
          }
        }
      }`, { ownerId: owner.id, title }, this.cwd);
        const project = createData.createProjectV2.projectV2;
        this.cachedProjectId = project.id;
        this.linkProjectToRepository(project.id);
        // New projects may already have a default Status field. Reuse/update it.
        try {
            const statusField = this.fetchStatusField(project.id);
            this.cachedFieldId = statusField.fieldId;
            this.cachedOptionIds = statusField.optionIds;
            this.ensureStatusColumns(project.id);
            const refreshed = this.fetchStatusField(project.id);
            this.cachedFieldId = refreshed.fieldId;
            this.cachedOptionIds = refreshed.optionIds;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!message.includes("Status field not found")) {
                throw err;
            }
            const createFieldData = graphql(`mutation CreateStatusField($projectId: ID!) {
          createProjectV2Field(input: {
            projectId: $projectId,
            dataType: SINGLE_SELECT,
            name: "Status",
            singleSelectOptions: [
              { name: "Draft",       color: GRAY,   description: "" },
              { name: "Ready",       color: BLUE,   description: "" },
              { name: "In Progress", color: YELLOW, description: "" },
              { name: "Review",      color: ORANGE, description: "" },
              { name: "Done",        color: GREEN,  description: "" }
            ]
          }) {
            projectV2Field {
              ... on ProjectV2SingleSelectField {
                id
                options { id name }
              }
            }
          }
        }`, { projectId: project.id }, this.cwd);
            const field = createFieldData.createProjectV2Field.projectV2Field;
            this.cachedFieldId = field.id;
            this.cachedOptionIds = new Map(field.options.map((o) => [o.name, o.id]));
        }
        return { id: project.id, number: project.number, title: project.title, url: project.url };
    }
    async getBoard() {
        const projectNumber = this.config.projectNumber;
        if (!projectNumber) {
            return null;
        }
        try {
            const ownerLogins = new Set([this.getRepoOwnerLogin()]);
            try {
                ownerLogins.add(getViewerLogin(this.cwd));
            }
            catch {
                // ignore fallback if viewer lookup fails
            }
            let node = null;
            for (const login of ownerLogins) {
                node = this.fetchProjectNode(login, projectNumber);
                if (node) {
                    break;
                }
            }
            if (!node) {
                return null;
            }
            return { id: node.id, number: node.number, title: node.title, url: node.url };
        }
        catch {
            return null;
        }
    }
    async getColumns() {
        const { fieldId, optionIds } = await this.ensureProjectCache();
        return BOARD_COLUMNS.map((name) => ({
            id: optionIds.get(name) ?? fieldId,
            name,
        }));
    }
    async createIssue(input) {
        const repo = this.getRepo();
        const { projectId, fieldId, optionIds } = await this.ensureProjectCache();
        // Create the issue via gh CLI (outputs URL, e.g. https://github.com/owner/repo/issues/123)
        const issueArgs = [
            "issue",
            "create",
            "--title",
            input.title,
            "--body",
            input.body,
            "--repo",
            repo,
        ];
        if (input.labels && input.labels.length > 0) {
            issueArgs.push("--label", input.labels.join(","));
        }
        const issueUrl = execFileSync("gh", issueArgs, {
            cwd: this.cwd,
            encoding: "utf-8",
            stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        const issueNumber = parseInt(issueUrl.split("/").pop() ?? "", 10);
        if (!issueNumber) {
            throw new Error(`Failed to parse issue number from URL: ${issueUrl}`);
        }
        // Fetch the node ID needed for the GraphQL project mutation
        const [owner, repoName] = repo.split("/");
        const nodeIdOutput = execFileSync("gh", ["api", `repos/${owner}/${repoName}/issues/${issueNumber}`, "--jq", ".node_id"], { cwd: this.cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
        const issueJson = { number: issueNumber, id: nodeIdOutput, url: issueUrl };
        // Add the issue to the project board
        const addData = graphql(`mutation AddProjectItem($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item {
            id
          }
        }
      }`, { projectId, contentId: issueJson.id }, this.cwd);
        const itemId = addData.addProjectV2ItemById.item.id;
        const targetColumn = input.column ?? "Draft";
        const optionId = optionIds.get(targetColumn);
        if (optionId) {
            graphql(`mutation UpdateItemField(
          $projectId: ID!,
          $itemId: ID!,
          $fieldId: ID!,
          $optionId: String!
        ) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: { singleSelectOptionId: $optionId }
          }) {
            projectV2Item {
              id
            }
          }
        }`, { projectId, itemId, fieldId, optionId }, this.cwd);
        }
        // Fetch the full issue details so we can return a complete IBoardIssue
        const fullIssue = await this.getIssue(issueJson.number);
        if (fullIssue) {
            return { ...fullIssue, column: targetColumn };
        }
        return {
            id: issueJson.id,
            number: issueJson.number,
            title: input.title,
            body: input.body,
            url: issueJson.url,
            column: targetColumn,
            labels: input.labels ?? [],
            assignees: [],
        };
    }
    async getIssue(issueNumber) {
        const repo = this.getRepo();
        let rawIssue;
        try {
            const output = execFileSync("gh", [
                "issue",
                "view",
                String(issueNumber),
                "--repo",
                repo,
                "--json",
                "number,title,body,url,id,labels,assignees",
            ], { cwd: this.cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
            rawIssue = JSON.parse(output);
        }
        catch {
            return null;
        }
        // Find which column this issue sits in by scanning all board items
        let column = null;
        try {
            const allIssues = await this.getAllIssues();
            const match = allIssues.find((i) => i.number === issueNumber);
            if (match) {
                column = match.column;
            }
        }
        catch {
            // Column stays null
        }
        return {
            id: rawIssue.id,
            number: rawIssue.number,
            title: rawIssue.title,
            body: rawIssue.body,
            url: rawIssue.url,
            column,
            labels: rawIssue.labels.map((l) => l.name),
            assignees: rawIssue.assignees.map((a) => a.login),
        };
    }
    async getIssuesByColumn(column) {
        const all = await this.getAllIssues();
        return all.filter((issue) => issue.column === column);
    }
    async getAllIssues() {
        const { projectId } = await this.ensureProjectCache();
        const data = graphql(`query GetProjectItems($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on Issue {
                    number
                    title
                    body
                    url
                    id
                    labels(first: 10) { nodes { name } }
                    assignees(first: 10) { nodes { login } }
                  }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`, { projectId }, this.cwd);
        const results = [];
        for (const item of data.node.items.nodes) {
            const parsed = this.parseItem(item);
            if (parsed) {
                results.push(parsed);
            }
        }
        return results;
    }
    async moveIssue(issueNumber, targetColumn) {
        const { projectId, fieldId, optionIds } = await this.ensureProjectCache();
        // Fetch project items to find the item node ID for the target issue
        const data = graphql(`query GetProjectItems($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on Issue {
                    number
                  }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue {
                      name
                      field {
                        ... on ProjectV2SingleSelectField {
                          name
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`, { projectId }, this.cwd);
        // Find the project item for this issue number
        const itemNode = data.node.items.nodes.find((n) => n.content?.number === issueNumber);
        if (!itemNode) {
            throw new Error(`Issue #${issueNumber} not found on the project board.`);
        }
        const optionId = optionIds.get(targetColumn);
        if (!optionId) {
            throw new Error(`Column "${targetColumn}" not found on the project board.`);
        }
        graphql(`mutation UpdateItemField(
        $projectId: ID!,
        $itemId: ID!,
        $fieldId: ID!,
        $optionId: String!
      ) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId,
          itemId: $itemId,
          fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) {
          projectV2Item {
            id
          }
        }
      }`, { projectId, itemId: itemNode.id, fieldId, optionId }, this.cwd);
    }
    async closeIssue(issueNumber) {
        const repo = this.getRepo();
        execFileSync("gh", ["issue", "close", String(issueNumber), "--repo", repo], { cwd: this.cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    }
    async commentOnIssue(issueNumber, body) {
        const repo = this.getRepo();
        execFileSync("gh", ["issue", "comment", String(issueNumber), "--repo", repo, "--body", body], { cwd: this.cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    }
}
//# sourceMappingURL=github-projects.js.map