import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

export const CONDUCTOR_PROJECTION_VERSION = 2;

export interface LegacyWorkspace {
  id: string;
  projectId: string;
  title: string;
  anchorThreadId: string;
  firstTabThreadId: string;
  branchName: string | null;
  environmentName: string | null;
}

export interface ConductorWorkspace {
  key: string;
  projectId: string;
  environmentId: string | null;
  title: string;
  branchName: string | null;
  threads: readonly PluginSidebarThread[];
  updatedAt: number;
  isUnassigned: boolean;
}

export interface ConductorProject {
  id: string;
  name: string;
  repositoryName: string | null;
  githubAccountLogin: string | null;
  workspaces: readonly ConductorWorkspace[];
}

export interface ConductorBackfillReport {
  version: number;
  signature: string;
  projectsScanned: number;
  environmentsProjected: number;
  activeConversations: number;
  archivedConversations: number;
  legacyOrganizersHidden: number;
  unassignedConversations: number;
  missingConversations: number;
  duplicateConversations: number;
}

export interface ConductorProjection {
  projects: readonly ConductorProject[];
  personalThreads: readonly PluginSidebarThread[];
  personalProjectId: string | null;
  report: ConductorBackfillReport;
  legacyOrganizerIds: ReadonlySet<string>;
}

function titleFor(thread: PluginSidebarThread): string {
  return (
    thread.title?.trim() ||
    thread.titleFallback?.trim() ||
    "Untitled conversation"
  );
}

function githubRepositoryName(remoteUrl: string | null | undefined) {
  if (!remoteUrl) return null;
  const match = remoteUrl
    .trim()
    .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/u);
  return match ? `${match[1]}/${match[2]}` : null;
}

function workspaceTitle(
  threads: readonly PluginSidebarThread[],
  isUnassigned: boolean,
): string {
  if (isUnassigned) return "Local conversations";
  const representative = threads[0];
  const firstConversationTitle = representative
    ? representative.title?.trim() || representative.titleFallback?.trim()
    : null;
  return (
    representative?.environment?.name?.trim() ||
    firstConversationTitle ||
    representative?.environment?.branchName?.trim() ||
    "Untitled workspace"
  );
}

export function buildConductorProjection(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  legacyWorkspaces: readonly LegacyWorkspace[] = [],
): ConductorProjection {
  const legacyOrganizerIds = new Set(
    legacyWorkspaces.map((workspace) => workspace.anchorThreadId),
  );
  const visibleThreads = threads.filter(
    (thread) => !legacyOrganizerIds.has(thread.id),
  );
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const personalProjectIds = new Set(
    projects
      .filter((project) => project.isPersonal)
      .map((project) => project.id),
  );
  const personalProjectId =
    projects.find((project) => project.isPersonal)?.id ?? null;
  const personalThreads: PluginSidebarThread[] = [];
  const groups = new Map<string, PluginSidebarThread[]>();

  for (const thread of visibleThreads) {
    if (thread.isArchived) continue;
    if (personalProjectIds.has(thread.projectId)) {
      personalThreads.push(thread);
      continue;
    }
    const environmentId = thread.environment?.id ?? null;
    const key = `${thread.projectId}:${environmentId ?? "local"}`;
    const group = groups.get(key);
    if (group) group.push(thread);
    else groups.set(key, [thread]);
  }

  const workspacesByProject = new Map<string, ConductorWorkspace[]>();
  for (const [key, group] of groups) {
    group.sort((left, right) => left.createdAt - right.createdAt);
    const first = group[0];
    if (!first) continue;
    const environmentId = first.environment?.id ?? null;
    const isUnassigned = environmentId === null;
    const workspace: ConductorWorkspace = {
      key,
      projectId: first.projectId,
      environmentId,
      title: workspaceTitle(group, isUnassigned),
      branchName: first.environment?.branchName ?? null,
      threads: group,
      updatedAt: Math.max(...group.map((thread) => thread.updatedAt)),
      isUnassigned,
    };
    const projectWorkspaces = workspacesByProject.get(first.projectId);
    if (projectWorkspaces) projectWorkspaces.push(workspace);
    else workspacesByProject.set(first.projectId, [workspace]);
  }

  const projectedProjects = [...projectById.entries()]
    .filter(([, project]) => !project.isPersonal)
    .map(([projectId, project]): ConductorProject => {
      const workspaces = workspacesByProject.get(projectId) ?? [];
      workspaces.sort((left, right) => right.updatedAt - left.updatedAt);
      return {
        id: projectId,
        name: project.name,
        repositoryName: githubRepositoryName(project.experimental_gitRemoteUrl),
        githubAccountLogin: project.experimental_githubAccountLogin ?? null,
        workspaces,
      };
    })
    .sort((left, right) =>
      (left.repositoryName ?? left.name).localeCompare(
        right.repositoryName ?? right.name,
      ),
    );

  personalThreads.sort((left, right) => {
    const createdAtDelta = right.createdAt - left.createdAt;
    return createdAtDelta !== 0
      ? createdAtDelta
      : left.id.localeCompare(right.id);
  });

  const projectedIds = [
    ...personalThreads.map((thread) => thread.id),
    ...projectedProjects.flatMap((project) =>
      project.workspaces.flatMap((workspace) =>
        workspace.threads.map((thread) => thread.id),
      ),
    ),
  ];
  const occurrences = new Map<string, number>();
  for (const id of projectedIds) {
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }
  const activeConversationIds = visibleThreads
    .filter((thread) => !thread.isArchived)
    .map((thread) => thread.id);
  const missingConversations = activeConversationIds.filter(
    (id) => !occurrences.has(id),
  ).length;
  const duplicateConversations = [...occurrences.values()].filter(
    (count) => count > 1,
  ).length;
  const signature = visibleThreads
    .map(
      (thread) =>
        `${thread.id}:${thread.projectId}:${thread.environment?.id ?? "local"}:${thread.isArchived ? 1 : 0}`,
    )
    .sort()
    .join("|");

  return {
    projects: projectedProjects,
    personalThreads,
    personalProjectId,
    legacyOrganizerIds,
    report: {
      version: CONDUCTOR_PROJECTION_VERSION,
      signature,
      projectsScanned: new Set(visibleThreads.map((thread) => thread.projectId))
        .size,
      environmentsProjected: projectedProjects.reduce(
        (count, project) =>
          count +
          project.workspaces.filter((workspace) => !workspace.isUnassigned)
            .length,
        0,
      ),
      activeConversations: activeConversationIds.length,
      archivedConversations: visibleThreads.filter(
        (thread) => thread.isArchived,
      ).length,
      legacyOrganizersHidden: threads.filter((thread) =>
        legacyOrganizerIds.has(thread.id),
      ).length,
      unassignedConversations: visibleThreads.filter(
        (thread) => !thread.isArchived && thread.environment?.id == null,
      ).length,
      missingConversations,
      duplicateConversations,
    },
  };
}

export function pickWorkspaceThread(
  workspace: ConductorWorkspace,
  activeThreadId: string | null,
): PluginSidebarThread | null {
  const active = workspace.threads.find(
    (thread) => thread.id === activeThreadId,
  );
  if (active) return active;
  const unread = workspace.threads
    .filter((thread) => thread.isUnread)
    .sort((left, right) => left.latestAttentionAt - right.latestAttentionAt)[0];
  if (unread) return unread;
  return (
    [...workspace.threads].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )[0] ?? null
  );
}

export function partitionWorkspaceThreads(
  threads: readonly PluginSidebarThread[],
  activeThreadId: string | null,
  maxVisible: number,
): {
  visible: readonly PluginSidebarThread[];
  hidden: readonly PluginSidebarThread[];
} {
  const limit = Math.max(1, maxVisible);
  const base = threads.slice(0, limit);
  const active = threads.find((thread) => thread.id === activeThreadId);
  const visible =
    active && !base.some((thread) => thread.id === active.id)
      ? [...base.slice(0, limit - 1), active]
      : base;
  const visibleIds = new Set(visible.map((thread) => thread.id));
  return {
    visible,
    hidden: threads.filter((thread) => !visibleIds.has(thread.id)),
  };
}

export function threadDisplayTitle(thread: PluginSidebarThread): string {
  return titleFor(thread);
}
