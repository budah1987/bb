import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

const dockerInspectMountSchema = z
  .object({
    Type: z.string(),
    Source: z.string(),
    Destination: z.string(),
    RW: z.boolean().optional(),
  })
  .passthrough();

const dockerInspectContainerSchema = z
  .object({
    Id: z.string().min(1),
    Name: z.string().min(1),
    Config: z
      .object({
        Image: z.string().min(1),
        Labels: z.record(z.string(), z.string()).nullable().optional(),
      })
      .passthrough(),
    State: z
      .object({
        Status: z.string().min(1),
      })
      .passthrough(),
    Mounts: z.array(dockerInspectMountSchema),
    NetworkSettings: z
      .object({
        Ports: z
          .record(
            z.string(),
            z
              .array(
                z
                  .object({
                    HostPort: z.string(),
                  })
                  .passthrough(),
              )
              .nullable(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const dockerInspectResponseSchema = z.array(dockerInspectContainerSchema);

interface CommandOutput {
  stdout: string;
}

export type DockerMountCommandRunner = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
) => Promise<CommandOutput>;

interface InspectWorkspaceDockerMountsArgs {
  env: NodeJS.ProcessEnv;
  run?: DockerMountCommandRunner;
  workspacePath: string;
}

type WorkspaceDockerMountsResult =
  HostDaemonOnlineRpcResult<"workspace.docker_mounts">;

async function defaultRun(
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv },
): Promise<CommandOutput> {
  const result = await execFileAsync(command, [...args], {
    env: options.env,
    encoding: "utf8",
    maxBuffer: COMMAND_MAX_BUFFER_BYTES,
    timeout: COMMAND_TIMEOUT_MS,
  });
  return { stdout: result.stdout };
}

function commandErrorCode(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return null;
}

function commandErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Command failed";
}

async function readGitLocation(
  path: string,
  run: DockerMountCommandRunner,
  env: NodeJS.ProcessEnv,
): Promise<{ branch: string | null; commonDir: string; root: string } | null> {
  try {
    const [rootResult, commonDirResult, branchResult] = await Promise.all([
      run("git", ["-C", path, "rev-parse", "--show-toplevel"], { env }),
      run(
        "git",
        ["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        { env },
      ),
      run("git", ["-C", path, "branch", "--show-current"], { env }),
    ]);
    const root = rootResult.stdout.trim();
    const commonDir = commonDirResult.stdout.trim();
    const branch = branchResult.stdout.trim();
    return root.length > 0 && commonDir.length > 0
      ? { branch: branch.length > 0 ? branch : null, commonDir, root }
      : null;
  } catch {
    return null;
  }
}

function allowlistedLabels(labels: Record<string, string> | null | undefined): {
  composeProject: string | null;
  composeService: string | null;
  composeWorkingDir: string | null;
  getbbRole: string | null;
} {
  return {
    composeProject: labels?.["com.docker.compose.project"] ?? null,
    composeService: labels?.["com.docker.compose.service"] ?? null,
    composeWorkingDir:
      labels?.["com.docker.compose.project.working_dir"] ?? null,
    getbbRole: labels?.["dev.getbb.role"] ?? null,
  };
}

function publishedPorts(
  ports: Record<string, { HostPort: string }[] | null> | undefined,
): number[] {
  const values = new Set<number>();
  for (const bindings of Object.values(ports ?? {})) {
    for (const binding of bindings ?? []) {
      const port = Number.parseInt(binding.HostPort, 10);
      if (Number.isInteger(port) && port >= 1 && port <= 65_535) {
        values.add(port);
      }
    }
  }
  return Array.from(values).sort((left, right) => left - right);
}

export async function inspectWorkspaceDockerMounts({
  env,
  run = defaultRun,
  workspacePath,
}: InspectWorkspaceDockerMountsArgs): Promise<WorkspaceDockerMountsResult> {
  const workspaceGit = await readGitLocation(workspacePath, run, env);
  if (workspaceGit === null) {
    return {
      outcome: "unavailable",
      reason: "docker_unavailable",
      message: "Could not resolve the environment Git checkout.",
    };
  }

  let containerIds: string[];
  try {
    const result = await run("docker", ["ps", "--all", "--quiet"], { env });
    containerIds = result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    const isNotInstalled = commandErrorCode(error) === "ENOENT";
    return {
      outcome: "unavailable",
      reason: isNotInstalled ? "docker_not_installed" : "docker_unavailable",
      message: isNotInstalled
        ? "Docker is not installed on this host."
        : `Docker is unavailable: ${commandErrorMessage(error)}`,
    };
  }

  if (containerIds.length === 0) {
    return { outcome: "available", containers: [], workspaceGit };
  }

  let inspected: z.infer<typeof dockerInspectResponseSchema>;
  try {
    const result = await run("docker", ["inspect", ...containerIds], { env });
    inspected = dockerInspectResponseSchema.parse(JSON.parse(result.stdout));
  } catch (error) {
    const individual = await Promise.all(
      containerIds.map(async (containerId) => {
        try {
          const result = await run("docker", ["inspect", containerId], { env });
          return (
            dockerInspectResponseSchema.parse(JSON.parse(result.stdout))[0] ??
            null
          );
        } catch {
          return null;
        }
      }),
    );
    inspected = individual.filter(
      (container): container is z.infer<typeof dockerInspectContainerSchema> =>
        container !== null,
    );
    if (inspected.length === 0) {
      return {
        outcome: "unavailable",
        reason: "docker_unavailable",
        message: `Docker inspection failed: ${commandErrorMessage(error)}`,
      };
    }
  }

  const containers = await Promise.all(
    inspected.map(async (container) => {
      const labels = allowlistedLabels(container.Config.Labels);
      return {
        composeWorkingDirGit:
          labels.composeWorkingDir === null
            ? null
            : await readGitLocation(labels.composeWorkingDir, run, env),
        id: container.Id,
        image: container.Config.Image,
        labels,
        mounts: await Promise.all(
          container.Mounts.filter(
            (mount) =>
              mount.Type === "bind" &&
              mount.Source.length > 0 &&
              mount.Destination.length > 0,
          ).map(async (mount) => ({
            destination: mount.Destination,
            readOnly: mount.RW === false,
            source: mount.Source,
            sourceGit: await readGitLocation(mount.Source, run, env),
          })),
        ),
        name: container.Name.replace(/^\//u, ""),
        publishedPorts: publishedPorts(container.NetworkSettings.Ports),
        state: container.State.Status,
      };
    }),
  );

  return { outcome: "available", containers, workspaceGit };
}
