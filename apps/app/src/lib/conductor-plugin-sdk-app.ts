/**
 * Direct host bindings for the app-bundled Conductor presentation.
 *
 * External plugin bundles use a runtime shim for this module. Conductor runs
 * inside the host bundle, so it must bind to the implementation directly.
 */
import type {
  PluginRpcClient,
  PluginRpcContract,
} from "@bb/plugin-sdk";
import {
  conductorRpcContract,
  type WorkspaceGitSummary,
} from "bb-plugin-conductor-workspaces/core";
import { callPluginRpc } from "./plugin-sdk-hooks";
import { pluginSdkAppImplementation } from "./plugin-sdk-app-impl";
import { sdk } from "./sdk";

export const {
  Markdown,
  ThreadChat,
  experimental_NewThreadComposer,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useSettings,
} = pluginSdkAppImplementation;

const CONDUCTOR_PLUGIN_ID = "conductor-workspaces";

function basename(value: string): string | null {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

async function readLegacyReconciliation(method: string, input: unknown) {
  return callPluginRpc(fetch, CONDUCTOR_PLUGIN_ID, method, input);
}

async function callConductorRpc(
  method: keyof typeof conductorRpcContract,
  input: unknown,
): Promise<unknown> {
  switch (method) {
    case "readWorkspaceGitSummaries": {
      const { environmentIds } =
        conductorRpcContract.readWorkspaceGitSummaries.input.parse(input);
      const summaries = await Promise.all(
        [...new Set(environmentIds)].map(
          async (environmentId): Promise<WorkspaceGitSummary | null> => {
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
          },
        ),
      );
      return conductorRpcContract.readWorkspaceGitSummaries.output.parse({
        summaries: summaries.filter(
          (summary): summary is WorkspaceGitSummary => summary !== null,
        ),
      });
    }
    case "readWorkspaceRenameDetails": {
      const { environmentId } =
        conductorRpcContract.readWorkspaceRenameDetails.input.parse(input);
      const environment = await sdk.environments.get({ environmentId });
      return conductorRpcContract.readWorkspaceRenameDetails.output.parse({
        displayName: environment.name,
        branchName: environment.branchName,
        folderName: environment.path ? basename(environment.path) : null,
      });
    }
    case "renameWorkspace": {
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
      return conductorRpcContract.renameWorkspace.output.parse({
        renamed: true,
      });
    }
    case "archiveWorkspace": {
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
    case "readReconciliation": {
      conductorRpcContract.readReconciliation.input.parse(input);
      try {
        return conductorRpcContract.readReconciliation.output.parse(
          await readLegacyReconciliation(method, input),
        );
      } catch {
        return { legacyWorkspaces: [], recordedSignature: null };
      }
    }
    case "recordReconciliation": {
      const report =
        conductorRpcContract.recordReconciliation.input.parse(input);
      if (
        report.missingConversations !== 0 ||
        report.duplicateConversations !== 0
      ) {
        throw new Error(
          "BBamir reconciliation refused an incomplete projection.",
        );
      }
      try {
        return conductorRpcContract.recordReconciliation.output.parse(
          await readLegacyReconciliation(method, report),
        );
      } catch {
        return { recorded: false };
      }
    }
    case "readGithubCatalog": {
      conductorRpcContract.readGithubCatalog.input.parse(input);
      const hosts = await sdk.hosts.list();
      const host =
        hosts.find((candidate) => candidate.status === "connected") ?? hosts[0];
      if (!host) {
        throw new Error(
          "No BB host is available for GitHub repository discovery",
        );
      }
      const catalog = await sdk.system.githubRepositories({ hostId: host.id });
      return conductorRpcContract.readGithubCatalog.output.parse({
        hostId: host.id,
        accounts: catalog.accounts,
        repositories: catalog.repositories,
      });
    }
    case "createGithubProject": {
      const request =
        conductorRpcContract.createGithubProject.input.parse(input);
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
    case "setProjectGithubAccount": {
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
    case "readProjectManager": {
      const request =
        conductorRpcContract.readProjectManager.input.parse(input);
      return conductorRpcContract.readProjectManager.output.parse(
        await sdk.projects.manager.show(request),
      );
    }
    case "updateProjectManager": {
      const { projectId, settings } =
        conductorRpcContract.updateProjectManager.input.parse(input);
      return conductorRpcContract.updateProjectManager.output.parse(
        await sdk.projects.manager.settings({ projectId, ...settings }),
      );
    }
    case "runProjectManager": {
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
    case "updateWorkspaceFromMain": {
      const request =
        conductorRpcContract.updateWorkspaceFromMain.input.parse(input);
      return conductorRpcContract.updateWorkspaceFromMain.output.parse(
        await sdk.environments.updateFromMain(request),
      );
    }
  }
}

const conductorRpcClient = {
  call: callConductorRpc,
} as PluginRpcClient<typeof conductorRpcContract>;

/** Core Conductor calls use BB routes, while external plugins keep plugin RPC. */
export function useRpc<
  Contract extends PluginRpcContract = PluginRpcContract,
>(): PluginRpcClient<Contract> {
  return conductorRpcClient as unknown as PluginRpcClient<Contract>;
}

export type * from "@bb/plugin-sdk";
