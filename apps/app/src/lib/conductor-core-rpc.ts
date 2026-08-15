import type { PluginRpcClient } from "@get-bb/plugin-sdk";
import {
  conductorRpcContract,
  type WorkspaceGitSummary,
} from "bb-plugin-conductor-workspaces/rpc-contract";
import { callPluginRpc } from "./plugin-sdk-hooks";
import { sdk } from "./sdk";

const CONDUCTOR_PLUGIN_ID = "conductor-workspaces";
// Git status reaches the host daemon. Keep sidebar refreshes from flooding it.
const MAX_GIT_SUMMARY_CONCURRENCY = 6;

const workspaceGitSummaryRequests = new Map<
  string,
  Promise<WorkspaceGitSummary | null>
>();

async function fetchWorkspaceGitSummary(
  environmentId: string,
): Promise<WorkspaceGitSummary | null> {
  try {
    const environment = await sdk.environments.get({ environmentId });
    const mergeBaseBranch =
      environment.mergeBaseBranch ??
      environment.baseBranch ??
      environment.defaultBranch;
    const status = await sdk.environments.status({
      environmentId,
      ...(mergeBaseBranch ? { mergeBaseBranch } : {}),
    });
    if (status.outcome !== "available") {
      return {
        environmentId,
        workspacePath: environment.path,
        gitAvailable: false,
        aheadCount: 0,
        behindCount: 0,
        changedFiles: 0,
      };
    }
    return {
      environmentId,
      workspacePath: environment.path,
      gitAvailable: true,
      aheadCount: status.workspace.mergeBase?.aheadCount ?? 0,
      behindCount: status.workspace.mergeBase?.behindCount ?? 0,
      changedFiles: status.workspace.workingTree.files.length,
    };
  } catch {
    return null;
  }
}

function readWorkspaceGitSummary(
  environmentId: string,
): Promise<WorkspaceGitSummary | null> {
  const activeRequest = workspaceGitSummaryRequests.get(environmentId);
  if (activeRequest) return activeRequest;

  const request = fetchWorkspaceGitSummary(environmentId).finally(() => {
    if (workspaceGitSummaryRequests.get(environmentId) === request) {
      workspaceGitSummaryRequests.delete(environmentId);
    }
  });
  workspaceGitSummaryRequests.set(environmentId, request);
  return request;
}

async function readWorkspaceGitSummaryBatch(
  environmentIds: readonly string[],
): Promise<Array<WorkspaceGitSummary | null>> {
  const summaries = new Array<WorkspaceGitSummary | null>(
    environmentIds.length,
  );
  let nextIndex = 0;

  async function readNext(): Promise<void> {
    while (nextIndex < environmentIds.length) {
      const index = nextIndex++;
      const environmentId = environmentIds[index];
      if (environmentId) {
        summaries[index] = await readWorkspaceGitSummary(environmentId);
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          MAX_GIT_SUMMARY_CONCURRENCY,
          environmentIds.length,
        ),
      },
      readNext,
    ),
  );
  return summaries;
}

async function readWorkspaceGitSummaries(input: unknown) {
  const { environmentIds } =
    conductorRpcContract.readWorkspaceGitSummaries.input.parse(input);
  const summaries = await readWorkspaceGitSummaryBatch([
    ...new Set(environmentIds),
  ]);
  return conductorRpcContract.readWorkspaceGitSummaries.output.parse({
    summaries: summaries.filter(
      (summary): summary is WorkspaceGitSummary => summary !== null,
    ),
  });
}

async function readWorkspaceRenameDetails(input: unknown) {
  const { environmentId } =
    conductorRpcContract.readWorkspaceRenameDetails.input.parse(input);
  const environment = await sdk.environments.get({ environmentId });
  const folderName = environment.path
    ? (environment.path.split(/[\\/]/).filter(Boolean).at(-1) ?? null)
    : null;
  return conductorRpcContract.readWorkspaceRenameDetails.output.parse({
    displayName: environment.name,
    branchName: environment.branchName,
    folderName,
  });
}

async function renameWorkspace(input: unknown) {
  const request = conductorRpcContract.renameWorkspace.input.parse(input);
  if (request.scope === "display") {
    await sdk.environments.update({
      environmentId: request.environmentId,
      name: request.value,
    });
  } else {
    await sdk.environments.rename({
      environmentId: request.environmentId,
      target: request.scope,
      value: request.value,
    });
  }
  return conductorRpcContract.renameWorkspace.output.parse({ renamed: true });
}

async function archiveWorkspace(input: unknown) {
  const request = conductorRpcContract.archiveWorkspace.input.parse(input);
  if (!request.confirmUncommittedChanges) {
    const status = await sdk.environments.status({
      environmentId: request.environmentId,
    });
    if (status.outcome !== "available") {
      throw new Error(
        "Couldn’t check this workspace for uncommitted changes. Nothing was archived.",
      );
    }
    if (status.workspace.workingTree.hasUncommittedChanges) {
      return conductorRpcContract.archiveWorkspace.output.parse({
        outcome: "confirmation_required",
      });
    }
  }
  const result = await sdk.environments.archiveThreads({
    environmentId: request.environmentId,
  });
  return conductorRpcContract.archiveWorkspace.output.parse({
    outcome: "archived",
    archivedThreadIds: result.archivedThreadIds,
  });
}

async function callLegacyReconciliation(method: string, input: unknown) {
  return callPluginRpc(fetch, CONDUCTOR_PLUGIN_ID, method, input);
}

async function readReconciliation(input: unknown) {
  conductorRpcContract.readReconciliation.input.parse(input);
  try {
    return conductorRpcContract.readReconciliation.output.parse(
      await callLegacyReconciliation("readReconciliation", input),
    );
  } catch {
    return { legacyWorkspaces: [], recordedSignature: null };
  }
}

async function recordReconciliation(input: unknown) {
  const report = conductorRpcContract.recordReconciliation.input.parse(input);
  if (
    report.missingConversations !== 0 ||
    report.duplicateConversations !== 0
  ) {
    throw new Error("BBamir reconciliation refused an incomplete projection.");
  }
  try {
    return conductorRpcContract.recordReconciliation.output.parse(
      await callLegacyReconciliation("recordReconciliation", report),
    );
  } catch {
    return { recorded: false };
  }
}

async function readGithubCatalog(input: unknown) {
  conductorRpcContract.readGithubCatalog.input.parse(input);
  const hosts = await sdk.hosts.list();
  const host =
    hosts.find((candidate) => candidate.status === "connected") ?? hosts[0];
  if (!host) {
    throw new Error("No BB host is available for GitHub repository discovery");
  }
  const catalog = await sdk.system.githubRepositories({ hostId: host.id });
  return conductorRpcContract.readGithubCatalog.output.parse({
    hostId: host.id,
    accounts: catalog.accounts,
    repositories: catalog.repositories,
  });
}

async function createGithubProject(input: unknown) {
  const request = conductorRpcContract.createGithubProject.input.parse(input);
  const project = await sdk.projects.create({
    name: request.name,
    source: {
      hostId: request.hostId,
      remoteUrl: request.remoteUrl,
      type: "clone",
    },
    githubAccountLogin: request.accountLogin,
  });
  return conductorRpcContract.createGithubProject.output.parse({
    projectId: project.id,
  });
}

async function setProjectGithubAccount(input: unknown) {
  const request =
    conductorRpcContract.setProjectGithubAccount.input.parse(input);
  const project = await sdk.projects.update({
    projectId: request.projectId,
    githubAccountLogin: request.accountLogin,
  });
  return conductorRpcContract.setProjectGithubAccount.output.parse({
    accountLogin: project.githubAccountLogin,
  });
}

async function readProjectManager(input: unknown) {
  const request = conductorRpcContract.readProjectManager.input.parse(input);
  return conductorRpcContract.readProjectManager.output.parse(
    await sdk.projects.manager.show(request),
  );
}

async function updateProjectManager(input: unknown) {
  const { projectId, settings } =
    conductorRpcContract.updateProjectManager.input.parse(input);
  return conductorRpcContract.updateProjectManager.output.parse(
    await sdk.projects.manager.settings({ projectId, ...settings }),
  );
}

async function runProjectManager(input: unknown) {
  const { projectId, prompt } =
    conductorRpcContract.runProjectManager.input.parse(input);
  const thread = await sdk.projects.manager.run({
    projectId,
    ...(prompt ? { prompt } : {}),
  });
  return conductorRpcContract.runProjectManager.output.parse({
    threadId: thread.id,
  });
}

async function updateWorkspaceFromMain(input: unknown) {
  const request =
    conductorRpcContract.updateWorkspaceFromMain.input.parse(input);
  return conductorRpcContract.updateWorkspaceFromMain.output.parse(
    await sdk.environments.updateFromMain(request),
  );
}

const conductorRpcHandlers = {
  archiveWorkspace,
  createGithubProject,
  readGithubCatalog,
  readProjectManager,
  readReconciliation,
  readWorkspaceGitSummaries,
  readWorkspaceRenameDetails,
  recordReconciliation,
  renameWorkspace,
  runProjectManager,
  setProjectGithubAccount,
  updateProjectManager,
  updateWorkspaceFromMain,
} satisfies Record<
  keyof typeof conductorRpcContract,
  (input: unknown) => Promise<unknown>
>;

async function callConductorRpc(
  method: keyof typeof conductorRpcContract,
  input: unknown,
): Promise<unknown> {
  return conductorRpcHandlers[method](input);
}

export const conductorRpcClient = {
  call: callConductorRpc,
} as PluginRpcClient<typeof conductorRpcContract>;
