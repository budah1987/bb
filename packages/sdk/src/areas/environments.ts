import {
  environmentSchema,
  type Environment,
  type WorkspaceCommitPaths,
} from "@bb/domain";
import {
  commitActionResponseSchema,
  pullRequestCreateActionResponseSchema,
  pullRequestDraftActionResponseSchema,
  pullRequestChecksRerunActionResponseSchema,
  pullRequestMetadataActionResponseSchema,
  pullRequestMergeActionResponseSchema,
  pullRequestReadyActionResponseSchema,
  publishToMainActionResponseSchema,
  updateFromMainActionResponseSchema,
  squashMergeActionResponseSchema,
  renameEnvironmentRequestSchema,
  updateEnvironmentRequestSchema,
} from "@bb/server-contract";
import type {
  CommitActionResponse,
  EnvironmentArchiveThreadsResponse,
  EnvironmentDiffBranchesQuery,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
  EnvironmentDiffPatchRequest,
  EnvironmentDiffPatchResponse,
  EnvironmentDiffQuery,
  EnvironmentDiffResponse,
  EnvironmentDockerActivityResponse,
  EnvironmentDockerControlResponse,
  EnvironmentDockerProvenanceResponse,
  EnvironmentDiffFilesResponse,
  EnvironmentPathsQuery,
  EnvironmentPullRequestResponse,
  EnvironmentPreviewsResponse,
  EnvironmentPreviewBypassResponse,
  EnvironmentPreviewShareResponse,
  EnvironmentPreviewUnshareResponse,
  EnvironmentStatusResponse,
  SimulatorAccessibilityResponse,
  SimulatorAttachResponse,
  SimulatorControlAction,
  SimulatorControlResponse,
  SimulatorLeaseResponse,
  SimulatorScreenshotResponse,
  SimulatorStatusResponse,
  SimulatorStopResponse,
  PullRequestMergeMethod,
  PullRequestCreateActionResponse,
  PullRequestMetadataActionResponse,
  PullRequestDraftActionResponse,
  PullRequestChecksRerunActionResponse,
  PullRequestChecksRerunOptions,
  PullRequestMergeActionResponse,
  PullRequestReadyActionResponse,
  PublishToMainActionResponse,
  UpdateFromMainActionResponse,
  RenameEnvironmentRequest,
  SquashMergeActionResponse,
  EnvironmentStatusQuery,
  UpdateEnvironmentRequest,
  WorkspacePathListResponse,
  TerminalSession,
} from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface EnvironmentActionArgs {
  environmentId: string;
}

export interface EnvironmentGetArgs extends EnvironmentActionArgs {
  signal?: AbortSignal;
}

type EnvironmentMergeBaseBranchUpdateValue = Exclude<
  UpdateEnvironmentRequest["mergeBaseBranch"],
  undefined
>;

type EnvironmentNameUpdateValue = Exclude<
  UpdateEnvironmentRequest["name"],
  undefined
>;
type EnvironmentGithubAccountUpdateValue = Exclude<
  UpdateEnvironmentRequest["githubAccountLogin"],
  undefined
>;

interface EnvironmentMergeBaseBranchUpdate {
  githubAccountLogin?: EnvironmentGithubAccountUpdateValue;
  mergeBaseBranch: EnvironmentMergeBaseBranchUpdateValue;
  name?: EnvironmentNameUpdateValue;
}

interface EnvironmentNameUpdate {
  githubAccountLogin?: EnvironmentGithubAccountUpdateValue;
  mergeBaseBranch?: EnvironmentMergeBaseBranchUpdateValue;
  name: EnvironmentNameUpdateValue;
}

interface EnvironmentGithubAccountUpdate {
  githubAccountLogin: EnvironmentGithubAccountUpdateValue;
  mergeBaseBranch?: EnvironmentMergeBaseBranchUpdateValue;
  name?: EnvironmentNameUpdateValue;
}

type EnvironmentUpdateFields =
  | EnvironmentMergeBaseBranchUpdate
  | EnvironmentNameUpdate
  | EnvironmentGithubAccountUpdate;

export type EnvironmentUpdateArgs = EnvironmentUpdateFields & {
  environmentId: string;
};

export type EnvironmentRenameArgs = RenameEnvironmentRequest & {
  environmentId: string;
};

export interface EnvironmentStatusArgs extends EnvironmentStatusQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export interface EnvironmentDockerProvenanceArgs extends EnvironmentActionArgs {
  signal?: AbortSignal;
}

export interface EnvironmentDockerActivityArgs extends EnvironmentActionArgs {
  signal?: AbortSignal;
}

export interface EnvironmentDockerControlArgs extends EnvironmentActionArgs {
  action: "restart" | "stop";
  containerId: string;
}

export interface EnvironmentPreviewsArgs extends EnvironmentActionArgs {
  signal?: AbortSignal;
}

export interface EnvironmentStartDevServerArgs extends EnvironmentActionArgs {
  command: string;
  preferredPort?: number;
  threadId: string;
  title: string;
}

export interface EnvironmentPreviewPortArgs extends EnvironmentActionArgs {
  port: number;
}

export interface EnvironmentPreviewBypassArgs extends EnvironmentActionArgs {
  providerId: string;
  secret: string;
}

export type EnvironmentDiffArgs = EnvironmentDiffQuery & {
  environmentId: string;
  signal?: AbortSignal;
};

export type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
  environmentId: string;
  signal?: AbortSignal;
};

export interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export interface EnvironmentCommitArgs {
  environmentId: string;
  paths?: WorkspaceCommitPaths;
}

export interface EnvironmentPullRequestChecksRerunArgs extends EnvironmentActionArgs {
  target: PullRequestChecksRerunOptions;
}

export interface EnvironmentSimulatorAttachArgs extends EnvironmentActionArgs {
  deviceUdid?: string;
}

export interface EnvironmentSimulatorControlArgs extends EnvironmentActionArgs {
  action: SimulatorControlAction;
}

export interface EnvironmentSquashMergeArgs {
  environmentId: string;
  mergeBaseBranch: string;
}

export interface EnvironmentPublishToMainArgs extends EnvironmentActionArgs {
  preserveTargetChanges?: boolean;
}

export type EnvironmentUpdateFromMainArgs = EnvironmentActionArgs;

export interface EnvironmentPullRequestMergeArgs {
  environmentId: string;
  method: PullRequestMergeMethod;
}

export interface EnvironmentPullRequestCreateArgs extends EnvironmentActionArgs {
  baseBranch: string;
  body: string;
  draft: boolean;
  title: string;
}

export interface EnvironmentPullRequestMetadataArgs extends EnvironmentActionArgs {
  baseBranch: string;
  fallbackTitle: string;
}

export type EnvironmentDiffPatchArgs = EnvironmentDiffPatchRequest & {
  environmentId: string;
  signal?: AbortSignal;
};

export interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
  environmentId: string;
  signal?: AbortSignal;
}

export type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
export type EnvironmentCommitResult = CommitActionResponse;
export type EnvironmentDiffResult = EnvironmentDiffResponse;
export type EnvironmentDiffBranchesResult = EnvironmentDiffBranchesResponse;
export type EnvironmentDiffFileResult = EnvironmentDiffFileResponse;
export type EnvironmentDiffFilesResult = EnvironmentDiffFilesResponse;
export type EnvironmentDiffPatchResult = EnvironmentDiffPatchResponse;
export type EnvironmentGetResult = Environment;
export type EnvironmentMarkPullRequestDraftResult =
  PullRequestDraftActionResponse;
export type EnvironmentCreatePullRequestResult =
  PullRequestCreateActionResponse;
export type EnvironmentPullRequestMetadataResult =
  PullRequestMetadataActionResponse;
export type EnvironmentMarkPullRequestReadyResult =
  PullRequestReadyActionResponse;
export type EnvironmentMergePullRequestResult = PullRequestMergeActionResponse;
export type EnvironmentPathsResult = WorkspacePathListResponse;
export type EnvironmentPullRequestResult = EnvironmentPullRequestResponse;
export type EnvironmentRenameResult = Environment;
export type EnvironmentSquashMergeResult = SquashMergeActionResponse;
export type EnvironmentPublishToMainResult = PublishToMainActionResponse;
export type EnvironmentUpdateFromMainResult = UpdateFromMainActionResponse;
export type EnvironmentStatusResult = EnvironmentStatusResponse;
export type EnvironmentDockerProvenanceResult =
  EnvironmentDockerProvenanceResponse;
export type EnvironmentDockerActivityResult = EnvironmentDockerActivityResponse;
export type EnvironmentDockerControlResult = EnvironmentDockerControlResponse;
export type EnvironmentPreviewsResult = EnvironmentPreviewsResponse;
export type EnvironmentStartDevServerResult = TerminalSession;
export type EnvironmentPreviewShareResult = EnvironmentPreviewShareResponse;
export type EnvironmentPreviewUnshareResult = EnvironmentPreviewUnshareResponse;
export type EnvironmentPreviewBypassResult = EnvironmentPreviewBypassResponse;
export type EnvironmentUpdateResult = Environment;
export type EnvironmentSimulatorStatusResult = SimulatorStatusResponse;
export type EnvironmentSimulatorAttachResult = SimulatorAttachResponse;
export type EnvironmentSimulatorLeaseResult = SimulatorLeaseResponse;
export type EnvironmentSimulatorControlResult = SimulatorControlResponse;
export type EnvironmentSimulatorStopResult = SimulatorStopResponse;
export type EnvironmentSimulatorAccessibilityResult =
  SimulatorAccessibilityResponse;
export type EnvironmentSimulatorScreenshotResult = SimulatorScreenshotResponse;

export interface EnvironmentsArea {
  archiveThreads(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentArchiveThreadsResult>;
  commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
  diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
  diffBranches(
    args: EnvironmentDiffBranchesArgs,
  ): Promise<EnvironmentDiffBranchesResult>;
  diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
  diffFiles(args: EnvironmentDiffArgs): Promise<EnvironmentDiffFilesResult>;
  diffPatch(
    args: EnvironmentDiffPatchArgs,
  ): Promise<EnvironmentDiffPatchResult>;
  dockerProvenance(
    args: EnvironmentDockerProvenanceArgs,
  ): Promise<EnvironmentDockerProvenanceResult>;
  dockerActivity(
    args: EnvironmentDockerActivityArgs,
  ): Promise<EnvironmentDockerActivityResult>;
  dockerControl(
    args: EnvironmentDockerControlArgs,
  ): Promise<EnvironmentDockerControlResult>;
  get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
  pullRequest(args: EnvironmentGetArgs): Promise<EnvironmentPullRequestResult>;
  previews(args: EnvironmentPreviewsArgs): Promise<EnvironmentPreviewsResult>;
  startDevServer(
    args: EnvironmentStartDevServerArgs,
  ): Promise<EnvironmentStartDevServerResult>;
  sharePreviewPort(
    args: EnvironmentPreviewPortArgs,
  ): Promise<EnvironmentPreviewShareResult>;
  unsharePreviewPort(
    args: EnvironmentPreviewPortArgs,
  ): Promise<EnvironmentPreviewUnshareResult>;
  bypassPreviewProtection(
    args: EnvironmentPreviewBypassArgs,
  ): Promise<EnvironmentPreviewBypassResult>;
  createPullRequest(
    args: EnvironmentPullRequestCreateArgs,
  ): Promise<EnvironmentCreatePullRequestResult>;
  generatePullRequestMetadata(
    args: EnvironmentPullRequestMetadataArgs,
  ): Promise<EnvironmentPullRequestMetadataResult>;
  rename(args: EnvironmentRenameArgs): Promise<EnvironmentRenameResult>;
  markPullRequestDraft(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentMarkPullRequestDraftResult>;
  markPullRequestReady(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentMarkPullRequestReadyResult>;
  mergePullRequest(
    args: EnvironmentPullRequestMergeArgs,
  ): Promise<EnvironmentMergePullRequestResult>;
  rerunPullRequestChecks(
    args: EnvironmentPullRequestChecksRerunArgs,
  ): Promise<PullRequestChecksRerunActionResponse>;
  paths(args: EnvironmentPathsArgs): Promise<EnvironmentPathsResult>;
  squashMerge(
    args: EnvironmentSquashMergeArgs,
  ): Promise<EnvironmentSquashMergeResult>;
  publishToMain(
    args: EnvironmentPublishToMainArgs,
  ): Promise<EnvironmentPublishToMainResult>;
  updateFromMain(
    args: EnvironmentUpdateFromMainArgs,
  ): Promise<EnvironmentUpdateFromMainResult>;
  status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
  simulatorStatus(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentSimulatorStatusResult>;
  simulatorAttach(
    args: EnvironmentSimulatorAttachArgs,
  ): Promise<EnvironmentSimulatorAttachResult>;
  simulatorLease(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentSimulatorLeaseResult>;
  simulatorControl(
    args: EnvironmentSimulatorControlArgs,
  ): Promise<EnvironmentSimulatorControlResult>;
  simulatorStop(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentSimulatorStopResult>;
  simulatorAccessibility(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentSimulatorAccessibilityResult>;
  simulatorScreenshot(
    args: EnvironmentActionArgs,
  ): Promise<EnvironmentSimulatorScreenshotResult>;
  update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}

function environmentUpdateJson(
  args: EnvironmentUpdateArgs,
): UpdateEnvironmentRequest {
  const request: UpdateEnvironmentRequest = {};
  if (args.githubAccountLogin !== undefined) {
    request.githubAccountLogin = args.githubAccountLogin;
  }
  if (args.mergeBaseBranch !== undefined) {
    request.mergeBaseBranch = args.mergeBaseBranch;
  }
  if (args.name !== undefined) {
    request.name = args.name;
  }
  return updateEnvironmentRequestSchema.parse(request);
}

function environmentStatusQuery(
  args: EnvironmentStatusArgs,
): EnvironmentStatusQuery {
  return {
    mergeBaseBranch: args.mergeBaseBranch,
  };
}

function environmentDiffQuery(args: EnvironmentDiffArgs): EnvironmentDiffQuery {
  switch (args.target) {
    case "uncommitted":
      return { target: args.target };
    case "branch_committed":
    case "all":
      return { target: args.target, mergeBaseBranch: args.mergeBaseBranch };
    case "commit":
      return { target: args.target, sha: args.sha };
  }
}

function environmentDiffFileQuery(
  args: EnvironmentDiffFileArgs,
): EnvironmentDiffFileQuery {
  switch (args.target) {
    case "uncommitted":
      return {
        path: args.path,
        side: args.side,
        target: args.target,
      };
    case "branch_committed":
    case "all":
      return {
        mergeBaseRef: args.mergeBaseRef,
        path: args.path,
        side: args.side,
        target: args.target,
      };
    case "commit":
      return {
        path: args.path,
        sha: args.sha,
        side: args.side,
        target: args.target,
      };
  }
}

function environmentDiffBranchesQuery(
  args: EnvironmentDiffBranchesArgs,
): EnvironmentDiffBranchesQuery {
  return {
    ...(args.query !== undefined ? { query: args.query } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.selectedBranch !== undefined
      ? { selectedBranch: args.selectedBranch }
      : {}),
  };
}

function environmentPathsQuery(
  args: EnvironmentPathsArgs,
): EnvironmentPathsQuery {
  return {
    includeDirectories: args.includeDirectories,
    includeFiles: args.includeFiles,
    limit: args.limit,
    query: args.query,
  };
}

export function createEnvironmentsArea(
  args: CreateSdkAreaArgs,
): EnvironmentsArea {
  const { transport } = args;
  return {
    async archiveThreads(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["archive-threads"].$post({
          param: { id: input.environmentId },
        }),
      );
    },
    async commit(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "commit",
            ...(input.paths === undefined
              ? {}
              : { options: { paths: input.paths } }),
          },
        }),
      );
      return commitActionResponseSchema.parse(body);
    },
    async diff(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffBranches(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.branches.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffBranchesQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffFile(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.file.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffFileQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffFiles(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.files.$get(
          {
            param: { id: input.environmentId },
            query: environmentDiffQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async diffPatch(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].diff.patch.$post(
          {
            param: { id: input.environmentId },
            json: {
              paths: input.paths,
              target: input.target,
            },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async get(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].$get(
          {
            param: { id: input.environmentId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
      return environmentSchema.parse(body);
    },
    async pullRequest(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["pull-request"].$get(
          {
            param: { id: input.environmentId },
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async createPullRequest(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "pull_request_create",
            options: {
              baseBranch: input.baseBranch,
              body: input.body,
              draft: input.draft,
              title: input.title,
            },
          },
        }),
      );
      return pullRequestCreateActionResponseSchema.parse(body);
    },
    async generatePullRequestMetadata(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "pull_request_metadata",
            options: {
              baseBranch: input.baseBranch,
              fallbackTitle: input.fallbackTitle,
            },
          },
        }),
      );
      return pullRequestMetadataActionResponseSchema.parse(body);
    },
    async rename(input) {
      const request = renameEnvironmentRequestSchema.parse({
        target: input.target,
        value: input.value,
      });
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].rename.$post({
          param: { id: input.environmentId },
          json: request,
        }),
      );
      return environmentSchema.parse(body);
    },
    async markPullRequestDraft(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: { action: "pull_request_draft" },
        }),
      );
      return pullRequestDraftActionResponseSchema.parse(body);
    },
    async markPullRequestReady(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: { action: "pull_request_ready" },
        }),
      );
      return pullRequestReadyActionResponseSchema.parse(body);
    },
    async mergePullRequest(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "pull_request_merge",
            options: { method: input.method },
          },
        }),
      );
      return pullRequestMergeActionResponseSchema.parse(body);
    },
    async rerunPullRequestChecks(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "pull_request_checks_rerun",
            options: input.target,
          },
        }),
      );
      return pullRequestChecksRerunActionResponseSchema.parse(body);
    },
    async paths(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].paths.$get(
          {
            param: { id: input.environmentId },
            query: environmentPathsQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async squashMerge(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "squash_merge",
            options: {
              mergeBaseBranch: input.mergeBaseBranch,
            },
          },
        }),
      );
      return squashMergeActionResponseSchema.parse(body);
    },
    async publishToMain(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "publish_to_main",
            options: {
              preserveTargetChanges: input.preserveTargetChanges ?? false,
            },
          },
        }),
      );
      return publishToMainActionResponseSchema.parse(body);
    },
    async updateFromMain(input) {
      const body = await transport.readJson(
        transport.api.v1.environments[":id"].actions.$post({
          param: { id: input.environmentId },
          json: {
            action: "update_from_main",
            options: {},
          },
        }),
      );
      return updateFromMainActionResponseSchema.parse(body);
    },
    async status(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].status.$get(
          {
            param: { id: input.environmentId },
            query: environmentStatusQuery(input),
          },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async dockerProvenance(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["docker-provenance"].$get(
          { param: { id: input.environmentId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async dockerActivity(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["docker-activity"].$get(
          { param: { id: input.environmentId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async dockerControl(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["docker-control"].$post({
          param: { id: input.environmentId },
          json: { action: input.action, containerId: input.containerId },
        }),
      );
    },
    async previews(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].previews.$get(
          { param: { id: input.environmentId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async startDevServer(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"]["dev-servers"].start.$post({
          param: { id: input.environmentId },
          json: {
            command: input.command,
            preferredPort: input.preferredPort,
            threadId: input.threadId,
            title: input.title,
          },
        }),
      );
    },
    async sharePreviewPort(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].previews.share.$post({
          param: { id: input.environmentId },
          json: { port: input.port },
        }),
      );
    },
    async unsharePreviewPort(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].previews.unshare.$post({
          param: { id: input.environmentId },
          json: { port: input.port },
        }),
      );
    },
    async bypassPreviewProtection(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].previews.bypass.$post({
          param: { id: input.environmentId },
          json: { providerId: input.providerId, secret: input.secret },
        }),
      );
    },
    async simulatorStatus(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.$get({
          param: { id: input.environmentId },
        }),
      );
    },
    async simulatorAttach(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.attach.$post({
          param: { id: input.environmentId },
          json:
            input.deviceUdid === undefined
              ? {}
              : { deviceUdid: input.deviceUdid },
        }),
      );
    },
    async simulatorLease(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.lease.$post({
          param: { id: input.environmentId },
        }),
      );
    },
    async simulatorControl(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.control.$post({
          param: { id: input.environmentId },
          json: { action: input.action },
        }),
      );
    },
    async simulatorStop(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.stop.$post({
          param: { id: input.environmentId },
        }),
      );
    },
    async simulatorAccessibility(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.accessibility.$get({
          param: { id: input.environmentId },
        }),
      );
    },
    async simulatorScreenshot(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].simulator.screenshot.$get({
          param: { id: input.environmentId },
        }),
      );
    },
    async update(input) {
      return transport.readJson(
        transport.api.v1.environments[":id"].$patch({
          param: { id: input.environmentId },
          json: environmentUpdateJson(input),
        }),
      );
    },
  };
}
