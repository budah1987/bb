import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type {
  EnvironmentPreviewProvider,
  EnvironmentPreviewsResponse,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { assembleDockerProvenance } from "./docker-provenance.js";
import type { WorkspaceCommandTarget } from "./workspace-command-target.js";

type DockerMountsResult = HostDaemonOnlineRpcResult<"workspace.docker_mounts">;
type GithubDeploymentsResult =
  HostDaemonOnlineRpcResult<"workspace.github_deployments">;
type GithubDeployment = Extract<
  GithubDeploymentsResult,
  { outcome: "available" }
>["deployments"][number];

const FRAME_PROBE_HOST_SUFFIXES = [
  ".vercel.app",
  ".netlify.app",
  ".pages.dev",
  ".github.io",
  ".onrender.com",
];

function canProbeFrameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      FRAME_PROBE_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

function safeHttpsUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function deploymentState(
  state: string | undefined,
): EnvironmentPreviewProvider["state"] {
  switch (state) {
    case "success":
      return "ready";
    case "error":
    case "failure":
      return "failed";
    case "queued":
    case "pending":
    case "in_progress":
      return "building";
    default:
      return "unknown";
  }
}

function localState(state: string): EnvironmentPreviewProvider["state"] {
  if (state === "running") return "ready";
  if (state === "created" || state === "restarting") return "building";
  return "failed";
}

function localProviders(
  result: Extract<DockerMountsResult, { outcome: "available" }>,
  sharedPorts: ReadonlySet<number>,
  tunnelIdentity: { baseDomain: string; label: string } | null,
): EnvironmentPreviewProvider[] {
  const provenance = assembleDockerProvenance({ result });
  if (provenance.outcome !== "available") return [];
  return provenance.services.flatMap((service) =>
    service.checkoutStatus !== "current_checkout"
      ? []
      : service.publishedPorts.map((port) => {
          const url =
            tunnelIdentity !== null && sharedPorts.has(port)
              ? `https://${tunnelIdentity.label}--${port}.${tunnelIdentity.baseDomain}`
              : null;
          return {
            environment: null,
            framePolicy: "unknown" as const,
            frameReason:
              url === null
                ? "Expose this port with Connect to open it remotely."
                : "Local frame policy is checked by the browser.",
            id: `docker:${service.id}:${port}`,
            kind: "local" as const,
            label: service.name,
            logUrl: null,
            source: "docker" as const,
            state: localState(service.state),
            updatedAt: null,
            url,
          };
        }),
  );
}

function latestDeployments(
  result: Extract<GithubDeploymentsResult, { outcome: "available" }>,
): GithubDeployment[] {
  const byEnvironment = new Map<string, GithubDeployment>();
  for (const deployment of result.deployments) {
    const current = byEnvironment.get(deployment.environment);
    if (current === undefined || deployment.updatedAt > current.updatedAt) {
      byEnvironment.set(deployment.environment, deployment);
    }
  }
  return Array.from(byEnvironment.values());
}

async function deploymentProvider(
  deployment: GithubDeployment,
): Promise<EnvironmentPreviewProvider> {
  const status = deployment.latestStatus;
  const previewUrl = safeHttpsUrl(status?.environmentUrl);
  const frame =
    previewUrl === null
      ? { framePolicy: "unknown" as const, frameReason: null }
      : await probePreviewFramePolicy(previewUrl);
  return {
    ...frame,
    environment: deployment.environment,
    id: `github:${deployment.environment}`,
    kind: "deployment",
    label: deployment.environment,
    logUrl: safeHttpsUrl(status?.logUrl),
    source: "github",
    state: deploymentState(status?.state),
    updatedAt: status?.updatedAt ?? deployment.updatedAt,
    url: previewUrl,
  };
}

function deploymentProviders(
  result: Extract<GithubDeploymentsResult, { outcome: "available" }>,
): Promise<EnvironmentPreviewProvider[]> {
  return Promise.all(latestDeployments(result).map(deploymentProvider));
}

export async function getEnvironmentPreviews(
  deps: AppDeps,
  args: { target: WorkspaceCommandTarget },
): Promise<EnvironmentPreviewsResponse> {
  const commandBase = {
    environmentId: args.target.environmentId,
    workspaceContext: args.target.workspaceContext,
  };
  const [docker, github] = await Promise.all([
    callHostRetryableOnlineRpc(deps, {
      hostId: args.target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { ...commandBase, type: "workspace.docker_mounts" },
    }),
    callHostRetryableOnlineRpc(deps, {
      hostId: args.target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { ...commandBase, type: "workspace.github_deployments" },
    }),
  ]);
  const issues: EnvironmentPreviewsResponse["issues"] = [];
  const declaredPorts = new Set(
    deps.sharedPorts.reconcileSharedPortsForHost(args.target.hostId).ports,
  );
  let tunnelIdentity: { baseDomain: string; label: string } | null = null;
  if (declaredPorts.size > 0) {
    try {
      tunnelIdentity = deps.sharedPorts.getTunnelIdentity(args.target.hostId);
    } catch {
      tunnelIdentity = null;
    }
  }
  if (
    docker.outcome === "unavailable" &&
    docker.reason !== "docker_not_installed"
  ) {
    issues.push({ source: "docker", message: docker.message });
  }
  if (
    github.outcome === "unavailable" &&
    github.reason !== "not_github_repository" &&
    github.reason !== "github_not_installed"
  ) {
    issues.push({ source: "github", message: github.message });
  }
  return {
    issues,
    providers: [
      ...(docker.outcome === "available"
        ? localProviders(docker, declaredPorts, tunnelIdentity)
        : []),
      ...(github.outcome === "available"
        ? await deploymentProviders(github)
        : []),
    ],
  };
}

export async function probePreviewFramePolicy(
  url: string,
  request: typeof fetch = fetch,
): Promise<Pick<EnvironmentPreviewProvider, "framePolicy" | "frameReason">> {
  if (!canProbeFrameUrl(url)) {
    return {
      framePolicy: "unknown",
      frameReason: "BB does not probe custom deployment hosts.",
    };
  }
  try {
    let currentUrl = url;
    let response: Response | null = null;
    for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
      if (!canProbeFrameUrl(currentUrl)) {
        return {
          framePolicy: "unknown",
          frameReason: "BB stopped a deployment probe at an untrusted host.",
        };
      }
      response = await request(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (location === null || redirectCount === 4) {
        return {
          framePolicy: "unknown",
          frameReason: "BB could not finish the deployment frame probe.",
        };
      }
      currentUrl = new URL(location, currentUrl).toString();
    }
    if (response === null) {
      return {
        framePolicy: "unknown",
        frameReason: "BB could not verify the deployment frame policy.",
      };
    }
    const xFrameOptions = response.headers
      .get("x-frame-options")
      ?.toLowerCase();
    if (
      xFrameOptions?.includes("deny") ||
      xFrameOptions?.includes("sameorigin")
    ) {
      return {
        framePolicy: "blocked",
        frameReason: "The deployment blocks embedding.",
      };
    }
    const csp = response.headers.get("content-security-policy")?.toLowerCase();
    if (/frame-ancestors\s+[^;]*(?:'none'|'self')/u.test(csp ?? "")) {
      return {
        framePolicy: "blocked",
        frameReason: "The deployment blocks embedding.",
      };
    }
    return { framePolicy: "allowed", frameReason: null };
  } catch {
    return {
      framePolicy: "unknown",
      frameReason: "BB could not verify the deployment frame policy.",
    };
  }
}
