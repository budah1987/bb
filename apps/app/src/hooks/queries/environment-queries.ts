import { useQuery } from "@tanstack/react-query";
import type {
  Environment,
  ThreadPullRequest,
  WorkspaceDiffTarget,
} from "@bb/domain";
import type {
  EnvironmentDiffFileResponse,
  EnvironmentDiffBranchesResponse,
  EnvironmentDiffFilesResponse,
  EnvironmentDockerActivityResponse,
  EnvironmentDockerProvenanceResponse,
  EnvironmentPreviewsResponse,
  EnvironmentPullRequestResponse,
  EnvironmentStatusResponse,
  HostPathListResponse,
  SimulatorStatusResponse,
  WorkspacePathListResponse,
} from "@bb/server-contract";
import type { EnvironmentDiffArgs } from "@bb/sdk/browser";
import {
  buildFilePreview,
  normalizeFilePreviewMimeType,
  type EnvironmentFilePreviewSource,
  type FilePreview,
} from "@/lib/file-preview";
import { sdk } from "@/lib/sdk";
import { useEnvironmentDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import {
  environmentDiffFilesQueryKey,
  environmentDockerActivityQueryKey,
  environmentDockerProvenanceQueryKey,
  environmentPreviewsQueryKey,
  environmentDiffTargetKey,
  environmentFilePreviewQueryKey,
  environmentMergeBaseBranchesQueryKey,
  environmentPullRequestQueryKey,
  environmentPathsQueryKey,
  environmentQueryKey,
  environmentWorkspaceFilesQueryKey,
  environmentSimulatorStatusQueryKey,
  environmentWorkStatusQueryKey,
} from "./query-keys";
import {
  resolveEnvironmentDiffFilesPlaceholder,
  resolveEnvironmentMergeBaseBranchesPlaceholder,
  resolveEnvironmentWorkStatusPlaceholder,
} from "./query-placeholders";
import { requireEnabledQueryArg } from "./query-helpers";
import {
  EXPENSIVE_MANUAL_QUERY_POLICY,
  REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
  REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
  TYPEAHEAD_QUERY_POLICY,
} from "./query-policies";

interface QueryOptions {
  enabled?: boolean;
}

interface EnvironmentPullRequestQueryOptions extends QueryOptions {
  accountLogin: string | null;
}

interface EnvironmentQueryOptions extends QueryOptions {
  staleTime?: number;
}

interface BranchQueryOptions extends QueryOptions {
  limit?: number;
  query?: string;
  selectedBranch?: string;
}

interface UseEnvironmentDiffFilesOptions extends QueryOptions {
  target?: WorkspaceDiffTarget;
}

const ENVIRONMENT_PULL_REQUEST_STALE_MS = 30_000;
const ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS = 60 * 60_000;
const ENVIRONMENT_ACTIVE_PULL_REQUEST_REFETCH_MS = 5_000;
const MERGE_BASE_BRANCHES_STALE_MS = 30_000;
const MERGE_BASE_BRANCHES_LIMIT = 50;
/** Staleness window for the environment diff TOC query. */
const ENVIRONMENT_DIFF_STALE_MS = 5_000;
const ENVIRONMENT_DOCKER_ACTIVITY_STALE_MS = 60_000;
const ENVIRONMENT_PREVIEWS_STALE_MS = 15_000;
const ENVIRONMENT_BUILDING_PREVIEW_REFETCH_MS = 10_000;
const ENVIRONMENT_WORKSPACE_FILES_LIMIT = 10_000;

function requireEnvironmentId(
  environmentId: string | null | undefined,
  hookName: string,
): string {
  return requireEnabledQueryArg({
    value: environmentId,
    hookName,
    argName: "environmentId",
  });
}

export function useEnvironment(
  environmentId: string | null | undefined,
  options?: EnvironmentQueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<Environment>({
    queryKey: environmentQueryKey(environmentId),
    queryFn: ({ signal }) =>
      sdk.environments.get({
        environmentId: requireEnvironmentId(environmentId, "useEnvironment"),
        signal,
      }),
    enabled,
    staleTime: options?.staleTime,
  });
}

export function useEnvironmentSimulatorStatus(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  return useQuery<SimulatorStatusResponse>({
    queryKey: environmentSimulatorStatusQueryKey(environmentId),
    queryFn: () =>
      sdk.environments.simulatorStatus({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentSimulatorStatus",
        ),
      }),
    enabled,
    refetchOnMount: "always",
    staleTime: 2_000,
  });
}

export function useEnvironmentWorkStatus(
  environmentId: string | null | undefined,
  mergeBaseBranch?: string,
  options?: QueryOptions,
) {
  const normalizedMergeBaseBranch = mergeBaseBranch ?? null;
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentStatusResponse>({
    queryKey: environmentWorkStatusQueryKey(
      environmentId,
      normalizedMergeBaseBranch,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.status({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentWorkStatus",
        ),
        mergeBaseBranch,
        signal,
      }),
    enabled,
    // Subscriptions can be absent while no UI is listening, so remount must
    // establish a fresh baseline instead of trusting cached data.
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
    staleTime: 0,
    placeholderData: (previousData, previousQuery) =>
      environmentId
        ? resolveEnvironmentWorkStatusPlaceholder(
            previousData,
            previousQuery?.queryKey,
            environmentId,
          )
        : undefined,
  });
}

export function useEnvironmentDockerProvenance(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  return useQuery<EnvironmentDockerProvenanceResponse>({
    queryKey: environmentDockerProvenanceQueryKey(environmentId),
    queryFn: ({ signal }) =>
      sdk.environments.dockerProvenance({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentDockerProvenance",
        ),
        signal,
      }),
    enabled,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

/**
 * Build freshness is a filesystem scan, so it never rides the provenance poll.
 * Callers enable it only while something is on screen that reads it, and it
 * refetches on demand rather than on a timer.
 */
export function useEnvironmentDockerActivity(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  return useQuery<EnvironmentDockerActivityResponse>({
    queryKey: environmentDockerActivityQueryKey(environmentId),
    queryFn: ({ signal }) =>
      sdk.environments.dockerActivity({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentDockerActivity",
        ),
        signal,
      }),
    enabled,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
    staleTime: ENVIRONMENT_DOCKER_ACTIVITY_STALE_MS,
  });
}

/**
 * Preview providers for the environment. Polls only while a deployment is
 * still building — a settled list changes when the user acts, not on a timer.
 */
export function useEnvironmentPreviews(
  environmentId: string | null | undefined,
  options?: QueryOptions,
) {
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  return useQuery<EnvironmentPreviewsResponse>({
    queryKey: environmentPreviewsQueryKey(environmentId),
    queryFn: ({ signal }) =>
      sdk.environments.previews({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPreviews",
        ),
        signal,
      }),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.providers.some(
        (provider) => provider.state === "building",
      )
        ? ENVIRONMENT_BUILDING_PREVIEW_REFETCH_MS
        : false,
    staleTime: ENVIRONMENT_PREVIEWS_STALE_MS,
  });
}

/**
 * The PR carried by a lookup response, or `null` when the lookup answered
 * "absent" or could not run ("unavailable" — treated like the active/absent
 * case for freshness so a transient gh failure retries on the short cycle).
 */
export function getEnvironmentPullRequestFromResponse(
  response: EnvironmentPullRequestResponse | undefined,
): ThreadPullRequest | null {
  return response?.outcome === "available" ? response.pullRequest : null;
}

export function getEnvironmentPullRequestStaleTime(
  pullRequest: ThreadPullRequest | null | undefined,
): number {
  return pullRequest?.state === "closed" || pullRequest?.state === "merged"
    ? ENVIRONMENT_SETTLED_PULL_REQUEST_STALE_MS
    : ENVIRONMENT_PULL_REQUEST_STALE_MS;
}

export function getEnvironmentPullRequestRefetchInterval(
  pullRequest: ThreadPullRequest | null | undefined,
): number | false {
  if (!pullRequest || pullRequest.state !== "open") {
    return false;
  }
  if (
    pullRequest.checks.state === "pending" ||
    pullRequest.mergeability.state === "unknown"
  ) {
    return ENVIRONMENT_ACTIVE_PULL_REQUEST_REFETCH_MS;
  }
  return false;
}

export function useEnvironmentPullRequest(
  environmentId: string | null | undefined,
  options: EnvironmentPullRequestQueryOptions,
) {
  const enabled = (options.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentPullRequestResponse>({
    queryKey: environmentPullRequestQueryKey(
      environmentId,
      options.accountLogin,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.pullRequest({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPullRequest",
        ),
        signal,
      }),
    enabled,
    refetchOnMount: true,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      getEnvironmentPullRequestRefetchInterval(
        getEnvironmentPullRequestFromResponse(query.state.data),
      ),
    staleTime: (query) =>
      getEnvironmentPullRequestStaleTime(
        getEnvironmentPullRequestFromResponse(query.state.data),
      ),
  });
}

export function useEnvironmentMergeBaseBranches(
  environmentId: string,
  options?: BranchQueryOptions,
) {
  const query = options?.query?.trim() ?? "";
  const selectedBranch = options?.selectedBranch?.trim();
  const limit = options?.limit ?? MERGE_BASE_BRANCHES_LIMIT;
  const enabled = (options?.enabled ?? true) && Boolean(environmentId);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });
  return useQuery<EnvironmentDiffBranchesResponse>({
    queryKey: environmentMergeBaseBranchesQueryKey(
      environmentId,
      query,
      limit,
      selectedBranch ?? "",
    ),
    queryFn: ({ signal }) =>
      sdk.environments.diffBranches({
        environmentId,
        ...(query ? { query } : {}),
        ...(selectedBranch ? { selectedBranch } : {}),
        limit: String(limit),
        signal,
      }),
    enabled,
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
    staleTime: MERGE_BASE_BRANCHES_STALE_MS,
    placeholderData: (previousData, previousQuery) =>
      environmentId
        ? resolveEnvironmentMergeBaseBranchesPlaceholder({
            previousData,
            previousQueryKey: previousQuery?.queryKey,
            environmentId,
            limit,
            selectedBranch: selectedBranch ?? "",
          })
        : undefined,
  });
}

export function useEnvironmentFilePreview(
  environmentId: string | null | undefined,
  path: string | null,
  source: EnvironmentFilePreviewSource | null,
  options?: QueryOptions,
) {
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(environmentId) &&
    Boolean(path) &&
    source !== null;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<FilePreview>({
    queryKey: environmentFilePreviewQueryKey(environmentId, path, source),
    queryFn: async ({ signal }) => {
      const resolvedPath = requireEnabledQueryArg({
        value: path,
        hookName: "useEnvironmentFilePreview",
        argName: "path",
      });
      const resolvedSource = requireEnabledQueryArg({
        value: source,
        hookName: "useEnvironmentFilePreview",
        argName: "source",
      });
      const response = await sdk.environments.diffFile({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentFilePreview",
        ),
        path: resolvedPath,
        side: resolvedSource.kind === "working-tree" ? "new" : "old",
        signal,
        ...(resolvedSource.kind === "merge-base"
          ? {
              target: "branch_committed" as const,
              mergeBaseRef: resolvedSource.ref,
            }
          : { target: "uncommitted" as const }),
      });
      return buildEnvironmentFilePreview(resolvedPath, response);
    },
    enabled,
    ...EXPENSIVE_MANUAL_QUERY_POLICY,
  });
}

interface UseEnvironmentWorkspaceFilesOptions extends QueryOptions {
  hostId: string | null | undefined;
  rootPath: string | null | undefined;
}

/**
 * Loads the workspace file list used by the right-panel explorer. This uses
 * the host file primitive because the environment paths endpoint is optimized
 * for fuzzy search and intentionally rejects an empty query.
 */
export function useEnvironmentWorkspaceFiles(
  environmentId: string | null | undefined,
  options: UseEnvironmentWorkspaceFilesOptions,
) {
  const rootPath = options.rootPath ?? null;
  const hostId = options.hostId ?? null;
  const enabled =
    (options.enabled ?? true) &&
    Boolean(environmentId) &&
    Boolean(hostId) &&
    Boolean(rootPath);
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<HostPathListResponse>({
    queryKey: environmentWorkspaceFilesQueryKey(environmentId, rootPath),
    queryFn: ({ signal }) =>
      sdk.files.listPaths({
        hostId: requireEnabledQueryArg({
          value: hostId,
          hookName: "useEnvironmentWorkspaceFiles",
          argName: "hostId",
        }),
        path: requireEnabledQueryArg({
          value: rootPath,
          hookName: "useEnvironmentWorkspaceFiles",
          argName: "rootPath",
        }),
        limit: ENVIRONMENT_WORKSPACE_FILES_LIMIT,
        includeFiles: true,
        includeDirectories: false,
        signal,
      }),
    enabled,
    staleTime: 0,
  });
}

interface UseEnvironmentPathSuggestionsArgs {
  environmentId: string | null | undefined;
  query: string | null;
  limit?: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}

/**
 * Search a thread environment's workspace for path suggestions. Project-agnostic
 * — the canonical workspace path search once a thread has an environment, used
 * for both file mentions and the new-tab file picker.
 */
export function useEnvironmentPathSuggestions(
  args: UseEnvironmentPathSuggestionsArgs,
) {
  const {
    environmentId,
    query,
    limit = 8,
    includeFiles,
    includeDirectories,
  } = args;
  const trimmedQuery = query?.trim() ?? "";
  const enabled = Boolean(environmentId) && trimmedQuery.length > 0;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<WorkspacePathListResponse>({
    queryKey: environmentPathsQueryKey(
      environmentId ?? undefined,
      trimmedQuery,
      limit,
      includeFiles,
      includeDirectories,
    ),
    queryFn: ({ signal }) =>
      sdk.environments.paths({
        environmentId: requireEnvironmentId(
          environmentId,
          "useEnvironmentPathSuggestions",
        ),
        query: trimmedQuery,
        limit: String(limit),
        includeFiles: includeFiles ? "true" : "false",
        includeDirectories: includeDirectories ? "true" : "false",
        signal,
      }),
    enabled,
    ...TYPEAHEAD_QUERY_POLICY,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Loads the diff tab's table of contents (one {@link DiffFileEntry} per changed
 * file, no patch text). Patches for visible rows are fetched separately and on
 * demand by {@link useEnvironmentDiffPatches}.
 */
export function useEnvironmentDiffFiles(
  environmentId: string,
  options: UseEnvironmentDiffFilesOptions,
) {
  const target = options.target;
  const enabled =
    (options.enabled ?? true) && Boolean(environmentId) && target !== undefined;
  useEnvironmentDetailRealtimeSubscription(environmentId, { enabled });

  return useQuery<EnvironmentDiffFilesResponse>({
    queryKey: environmentDiffFilesQueryKey(
      environmentId,
      target?.type ?? null,
      environmentDiffTargetKey(target),
    ),
    queryFn: ({ signal }) =>
      sdk.environments.diffFiles({
        ...buildEnvironmentDiffArgs(
          environmentId,
          requireEnabledQueryArg({
            value: target,
            hookName: "useEnvironmentDiffFiles",
            argName: "target",
          }),
        ),
        signal,
      }),
    enabled,
    placeholderData: (previousData, previousQuery) =>
      resolveEnvironmentDiffFilesPlaceholder(
        previousData,
        previousQuery?.queryKey,
        environmentId,
      ),
    ...REALTIME_OWNED_MOUNT_BASELINE_QUERY_POLICY,
    staleTime: ENVIRONMENT_DIFF_STALE_MS,
  });
}

function buildEnvironmentDiffArgs(
  environmentId: string,
  target: WorkspaceDiffTarget,
): EnvironmentDiffArgs {
  switch (target.type) {
    case "uncommitted":
      return { environmentId, target: target.type };
    case "branch_committed":
    case "all":
      return {
        environmentId,
        mergeBaseBranch: target.mergeBaseBranch,
        target: target.type,
      };
    case "commit":
      return { environmentId, sha: target.sha, target: target.type };
  }
}

function decodeBase64Bytes(content: string): Uint8Array {
  const binaryContent = atob(content);
  const bytes = new Uint8Array(binaryContent.length);
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const binaryChunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binaryChunks.push(
      String.fromCharCode(...bytes.subarray(index, index + chunkSize)),
    );
  }
  return btoa(binaryChunks.join(""));
}

function buildEnvironmentFilePreview(
  path: string,
  response: EnvironmentDiffFileResponse,
): FilePreview {
  const contentBytes =
    response.contentEncoding === "base64"
      ? decodeBase64Bytes(response.content)
      : new TextEncoder().encode(response.content);
  const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
  const base64Content =
    response.contentEncoding === "base64"
      ? response.content
      : encodeBase64Bytes(contentBytes);
  return buildFilePreview({
    contentBytes,
    mimeType,
    name: path.split("/").at(-1),
    path,
    url: `data:${mimeType};base64,${base64Content}`,
  });
}
