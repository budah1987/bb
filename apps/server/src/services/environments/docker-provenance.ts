import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type {
  EnvironmentDockerActivityResponse,
  EnvironmentDockerProvenanceResponse,
  EnvironmentDockerService,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import type { WorkspaceCommandTarget } from "./workspace-command-target.js";

type DockerMountsResult = HostDaemonOnlineRpcResult<"workspace.docker_mounts">;
type DockerPathActivityResult =
  HostDaemonOnlineRpcResult<"workspace.docker_path_activity">;

interface AssembleDockerProvenanceArgs {
  result: Extract<DockerMountsResult, { outcome: "available" }>;
}

function dockerServiceIdentity(
  container: Extract<
    DockerMountsResult,
    { outcome: "available" }
  >["containers"][number],
  workspaceGit: Extract<
    DockerMountsResult,
    { outcome: "available" }
  >["workspaceGit"],
): Pick<
  EnvironmentDockerService,
  "checkoutStatus" | "kind" | "ownerBranch" | "ownerCheckoutRoot"
> | null {
  const locations = container.mounts.flatMap((mount) =>
    mount.sourceGit?.commonDir === workspaceGit.commonDir
      ? [mount.sourceGit]
      : [],
  );
  if (container.composeWorkingDirGit?.commonDir === workspaceGit.commonDir) {
    locations.push(container.composeWorkingDirGit);
  }
  if (locations.length === 0) return null;

  const ownerRoots = new Set(locations.map((location) => location.root));
  const ownerCheckoutRoot =
    ownerRoots.size === 1 ? (ownerRoots.values().next().value ?? null) : null;
  const ownerBranch =
    locations.find((location) => location.root === ownerCheckoutRoot)?.branch ??
    null;
  const isSharedWorker = container.labels.getbbRole === "shared-worker";
  const checkoutStatus: EnvironmentDockerService["checkoutStatus"] =
    isSharedWorker
      ? "declared_shared"
      : ownerRoots.size > 1
        ? "ambiguous"
        : ownerCheckoutRoot === workspaceGit.root
          ? "current_checkout"
          : "wrong_checkout";
  return {
    checkoutStatus,
    kind: isSharedWorker
      ? "shared_worker"
      : container.publishedPorts.length > 0
        ? "server"
        : "background_service",
    ownerBranch,
    ownerCheckoutRoot,
  };
}

const BUILD_DIRECTORY_NAMES = new Set(["dist", "build", "out", ".next"]);

function dockerActivityPaths(
  result: Extract<DockerMountsResult, { outcome: "available" }>,
) {
  return result.containers.flatMap((container) => {
    const buildMount = container.mounts.find(
      (mount) =>
        mount.sourceGit?.root === result.workspaceGit.root &&
        BUILD_DIRECTORY_NAMES.has(path.basename(mount.source)),
    );
    if (buildMount === undefined) return [];
    const build = path.relative(result.workspaceGit.root, buildMount.source);
    if (build.startsWith("..") || path.isAbsolute(build)) return [];
    return [
      {
        build,
        serviceId: container.id,
        source: path.join(path.dirname(build), "src"),
      },
    ];
  });
}

export function assembleDockerProvenance({
  result,
}: AssembleDockerProvenanceArgs): EnvironmentDockerProvenanceResponse {
  const services = result.containers.flatMap((container) => {
    const repositoryMounts = container.mounts.filter(
      (mount) => mount.sourceGit?.commonDir === result.workspaceGit.commonDir,
    );
    const identity = dockerServiceIdentity(container, result.workspaceGit);
    if (identity === null) return [];
    return [
      {
        ...identity,
        id: container.id,
        image: container.image,
        mounts: repositoryMounts.map((mount) => ({
          checkoutRoot: mount.sourceGit?.root ?? mount.source,
          destination: mount.destination,
          readOnly: mount.readOnly,
          source: mount.source,
        })),
        name: container.name,
        publishedPorts: container.publishedPorts,
        state: container.state,
      },
    ];
  });
  return {
    outcome: "available",
    environmentPath: result.workspaceGit.root,
    services,
  };
}

function freshnessFor(
  source:
    | Extract<
        DockerPathActivityResult,
        { outcome: "available" }
      >["paths"][number]
    | null,
  build:
    | Extract<
        DockerPathActivityResult,
        { outcome: "available" }
      >["paths"][number]
    | null,
): "fresh" | "missing_build" | "stale" | "unknown" {
  if (
    source === null ||
    source.limited ||
    source.newestFileMtimeMs === null ||
    build === null ||
    build.limited
  ) {
    return "unknown";
  }
  if (build.newestFileMtimeMs === null) return "missing_build";
  return source.newestFileMtimeMs > build.newestFileMtimeMs + 1_000
    ? "stale"
    : "fresh";
}

export function assembleDockerActivity(
  mounts: Extract<DockerMountsResult, { outcome: "available" }>,
  activity: Extract<DockerPathActivityResult, { outcome: "available" }>,
): EnvironmentDockerActivityResponse {
  const paths = new Map(activity.paths.map((entry) => [entry.path, entry]));
  return {
    outcome: "available",
    activities: dockerActivityPaths(mounts).map((candidate) => {
      const source = paths.get(candidate.source) ?? null;
      const build = paths.get(candidate.build) ?? null;
      return {
        build,
        freshness: freshnessFor(source, build),
        serviceId: candidate.serviceId,
        source,
      };
    }),
  };
}

export async function getEnvironmentDockerProvenance(
  deps: AppDeps,
  args: {
    target: WorkspaceCommandTarget;
  },
): Promise<EnvironmentDockerProvenanceResponse> {
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.docker_mounts",
      environmentId: args.target.environmentId,
      workspaceContext: args.target.workspaceContext,
    },
  });
  if (result.outcome === "unavailable") {
    return result;
  }
  return assembleDockerProvenance({ result });
}

async function getDockerActivityForMounts(
  deps: AppDeps,
  target: WorkspaceCommandTarget,
  mounts: Extract<DockerMountsResult, { outcome: "available" }>,
): Promise<EnvironmentDockerActivityResponse> {
  const candidates = dockerActivityPaths(mounts);
  if (candidates.length === 0) {
    return { outcome: "available", activities: [] };
  }
  const paths = Array.from(
    new Set(
      candidates.flatMap((candidate) => [candidate.source, candidate.build]),
    ),
  );
  const activity = await callHostRetryableOnlineRpc(deps, {
    hostId: target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.docker_path_activity",
      environmentId: target.environmentId,
      workspaceContext: target.workspaceContext,
      paths,
    },
  });
  return activity.outcome === "unavailable"
    ? { outcome: "unavailable", message: activity.message }
    : assembleDockerActivity(mounts, activity);
}

export async function getEnvironmentDockerActivity(
  deps: AppDeps,
  args: { target: WorkspaceCommandTarget },
): Promise<EnvironmentDockerActivityResponse> {
  const mounts = await callHostRetryableOnlineRpc(deps, {
    hostId: args.target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.docker_mounts",
      environmentId: args.target.environmentId,
      workspaceContext: args.target.workspaceContext,
    },
  });
  if (mounts.outcome === "unavailable") {
    return { outcome: "unavailable", message: mounts.message };
  }
  return getDockerActivityForMounts(deps, args.target, mounts);
}
