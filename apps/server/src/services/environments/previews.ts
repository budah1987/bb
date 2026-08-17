import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { listTerminalSessionsByEnvironment } from "@bb/db";
import type {
  EnvironmentPreviewProvider,
  EnvironmentPreviewsResponse,
  TerminalOutputResponse,
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

const DEV_SERVER_FAILURE_PATTERNS = [
  /\[vite\]\s+Internal server error/giu,
  /Failed to compile/giu,
  /Module build failed/giu,
  /Build failed with/giu,
  /HMR update failed/giu,
  /ERROR in /gu,
];
const DEV_SERVER_RECOVERY_PATTERNS = [
  /compiled successfully/giu,
  /ready in \d/giu,
  /hmr update(?! failed)/giu,
  /built in \d/giu,
];
const ANSI_ESCAPE_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/gu;

function lastPatternIndex(value: string, patterns: readonly RegExp[]): number {
  let latest = -1;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of value.matchAll(pattern)) {
      latest = Math.max(latest, match.index);
    }
  }
  return latest;
}

export function terminalOutputHasActiveBuildError(
  output: TerminalOutputResponse,
): boolean {
  const text = Buffer.concat(
    output.chunks.map((chunk) => Buffer.from(chunk.dataBase64, "base64")),
  )
    .toString("utf8")
    .replace(ANSI_ESCAPE_PATTERN, "");
  const failureIndex = lastPatternIndex(text, DEV_SERVER_FAILURE_PATTERNS);
  if (failureIndex < 0) return false;
  return failureIndex > lastPatternIndex(text, DEV_SERVER_RECOVERY_PATTERNS);
}

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

export function buildVercelProtectionBypassUrl(
  value: string,
  secret: string,
): string | null {
  const previewUrl = safeHttpsUrl(value);
  if (previewUrl === null) return null;
  const url = new URL(previewUrl);
  if (!url.hostname.endsWith(".vercel.app")) return null;
  url.searchParams.set("x-vercel-protection-bypass", secret);
  url.searchParams.set("x-vercel-set-bypass-cookie", "samesitenone");
  return url.toString();
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
            branchUrl: null,
            deploymentUrl: null,
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
            port,
            shared: sharedPorts.has(port),
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
  const branchUrl = safeHttpsUrl(status?.branchUrl);
  const deploymentUrl = safeHttpsUrl(status?.deploymentUrl);
  const previewUrl = branchUrl ?? deploymentUrl;
  const frame =
    previewUrl === null
      ? { framePolicy: "unknown" as const, frameReason: null }
      : await probePreviewFramePolicy(previewUrl);
  return {
    ...frame,
    branchUrl,
    deploymentUrl,
    environment: deployment.environment,
    id: `github:${deployment.environment}`,
    kind: "deployment",
    label: deployment.environment,
    logUrl: safeHttpsUrl(status?.logUrl),
    port: null,
    shared: false,
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

async function terminalProviders(
  deps: AppDeps,
  target: WorkspaceCommandTarget,
  sharedPorts: ReadonlySet<number>,
  tunnelIdentity: { baseDomain: string; label: string } | null,
): Promise<EnvironmentPreviewProvider[]> {
  const latestSessions = new Map<
    number,
    ReturnType<typeof listTerminalSessionsByEnvironment>[number]
  >();
  for (const session of listTerminalSessionsByEnvironment(
    deps.db,
    target.environmentId,
  )) {
    if (session.devServerPort === null) continue;
    latestSessions.set(session.devServerPort, session);
  }
  const sessions = Array.from(latestSessions.values());
  return Promise.all(
    sessions.map(async (session) => {
      const port = session.devServerPort!;
      const [status, hasActiveBuildError] = await Promise.all([
        callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "workspace.port_status",
            environmentId: target.environmentId,
            workspaceContext: target.workspaceContext,
            port,
          },
        }),
        session.status === "running"
          ? deps.terminalSessions
              .readTerminalOutput({
                query: { tailBytes: 32_768 },
                terminalId: session.id,
              })
              .then(terminalOutputHasActiveBuildError)
              .catch(() => false)
          : Promise.resolve(false),
      ]);
      const shared = sharedPorts.has(port);
      return {
        branchUrl: null,
        deploymentUrl: null,
        environment: null,
        framePolicy: "unknown" as const,
        frameReason: hasActiveBuildError
          ? "The development server reported a recent build error."
          : shared
            ? "Local frame policy is checked by the browser."
            : "Expose this port with Connect to open it remotely.",
        id: `terminal:${port}`,
        kind: "local" as const,
        label: session.title,
        logUrl: null,
        port,
        shared,
        source: "terminal" as const,
        state: hasActiveBuildError
          ? ("failed" as const)
          : session.status === "running" && status.isListening
            ? ("ready" as const)
            : session.status === "starting" || session.status === "running"
              ? ("building" as const)
              : ("failed" as const),
        updatedAt: null,
        url:
          shared && tunnelIdentity !== null
            ? `https://${tunnelIdentity.label}--${port}.${tunnelIdentity.baseDomain}`
            : null,
      };
    }),
  );
}

export async function getEnvironmentPreviews(
  deps: AppDeps,
  args: {
    githubAccountLogin: string | null;
    target: WorkspaceCommandTarget;
  },
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
      command: {
        ...commandBase,
        type: "workspace.github_deployments",
        githubAccountLogin: args.githubAccountLogin,
      },
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
      ...(await terminalProviders(
        deps,
        args.target,
        declaredPorts,
        tunnelIdentity,
      )),
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
