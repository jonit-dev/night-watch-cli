// Internal GraphQL response shapes and raw CLI types for the GitHub Projects provider.

export interface IProjectV2Node {
  id: string;
  number: number;
  title: string;
  url: string;
}

export interface IGetUserProjectData {
  user: { projectV2: IProjectV2Node | null } | null;
}

export interface IGetOrgProjectData {
  organization: { projectV2: IProjectV2Node | null } | null;
}

export interface ICreateProjectData {
  createProjectV2: {
    projectV2: {
      id: string;
      number: number;
      url: string;
      title: string;
    };
  };
}

export interface IRepositoryOwnerData {
  repository: {
    id: string;
    owner: {
      __typename: 'User' | 'Organization' | string;
      id: string;
      login: string;
    };
  } | null;
}

export interface IRepoOwnerInfo {
  id: string;
  login: string;
  type: 'User' | 'Organization';
}

export interface IListUserProjectsData {
  user: {
    projectsV2: {
      nodes: IProjectV2Node[];
    };
  } | null;
}

export interface IListOrgProjectsData {
  organization: {
    projectsV2: {
      nodes: IProjectV2Node[];
    };
  } | null;
}

export interface IStatusFieldOption {
  id: string;
  name: string;
}

export interface IStatusFieldData {
  node: {
    field: {
      id: string;
      options: IStatusFieldOption[];
    } | null;
  };
}

export interface ICreateFieldData {
  createProjectV2Field: {
    projectV2Field: {
      id: string;
      options: IStatusFieldOption[];
    };
  };
}

export interface IUpdateFieldData {
  updateProjectV2Field: {
    projectV2Field: { id: string; options: IStatusFieldOption[] };
  };
}

export interface IProjectItemNode {
  id: string;
  content: {
    number?: number;
    title?: string;
    body?: string;
    url?: string;
    id?: string;
    repository?: { nameWithOwner?: string };
    labels?: { nodes: Array<{ name: string }> };
    assignees?: { nodes: Array<{ login: string }> };
  } | null;
  fieldValues: {
    nodes: Array<{
      name?: string;
      field?: { name?: string };
    }>;
  };
}

export interface IProjectItemsData {
  node: {
    items: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: IProjectItemNode[];
    };
  };
}

export interface IAddItemData {
  addProjectV2ItemById: { item: { id: string } };
}

export interface IUpdateItemFieldData {
  updateProjectV2ItemFieldValue: { projectV2Item: { id: string } };
}

export interface IRawIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  id: string;
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
}
