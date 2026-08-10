import { describe, expect, it } from "vitest";
import {
  inspectWorkspaceDockerMounts,
  type DockerMountCommandRunner,
} from "./docker-mounts.js";

function runner(responses: Record<string, string>): DockerMountCommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const stdout = responses[key];
    if (stdout === undefined) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return { stdout };
  };
}

describe("inspectWorkspaceDockerMounts", () => {
  it("returns bind mounts with Git checkout metadata", async () => {
    const inspectJson = JSON.stringify([
      {
        Id: "container-1",
        Name: "/api",
        Config: {
          Image: "example/api:latest",
          Labels: {
            "com.docker.compose.project": "bb",
            "com.docker.compose.project.working_dir": "/repo-main",
            "com.docker.compose.service": "api",
            "dev.getbb.role": "shared-worker",
            "ignored.secret": "must-not-cross-the-wire",
          },
        },
        State: { Status: "running" },
        Mounts: [
          {
            Type: "bind",
            Source: "/repo-main/apps/api/dist",
            Destination: "/app/apps/api/dist",
            RW: true,
          },
          {
            Type: "volume",
            Source: "cache",
            Destination: "/cache",
            RW: true,
          },
        ],
        NetworkSettings: {
          Ports: { "3000/tcp": [{ HostPort: "43100" }] },
        },
      },
    ]);
    const run = runner({
      "git -C /repo-feature rev-parse --show-toplevel": "/repo-feature\n",
      "git -C /repo-feature rev-parse --path-format=absolute --git-common-dir":
        "/repo-main/.git\n",
      "git -C /repo-feature branch --show-current": "feature\n",
      "docker ps --all --quiet": "container-1\n",
      "docker inspect container-1": inspectJson,
      "git -C /repo-main rev-parse --show-toplevel": "/repo-main\n",
      "git -C /repo-main rev-parse --path-format=absolute --git-common-dir":
        "/repo-main/.git\n",
      "git -C /repo-main branch --show-current": "main\n",
      "git -C /repo-main/apps/api/dist rev-parse --show-toplevel":
        "/repo-main\n",
      "git -C /repo-main/apps/api/dist rev-parse --path-format=absolute --git-common-dir":
        "/repo-main/.git\n",
      "git -C /repo-main/apps/api/dist branch --show-current": "main\n",
    });

    await expect(
      inspectWorkspaceDockerMounts({
        env: {},
        run,
        workspacePath: "/repo-feature",
      }),
    ).resolves.toEqual({
      outcome: "available",
      workspaceGit: {
        branch: "feature",
        commonDir: "/repo-main/.git",
        root: "/repo-feature",
      },
      containers: [
        {
          composeWorkingDirGit: {
            branch: "main",
            commonDir: "/repo-main/.git",
            root: "/repo-main",
          },
          id: "container-1",
          image: "example/api:latest",
          labels: {
            composeProject: "bb",
            composeService: "api",
            composeWorkingDir: "/repo-main",
            getbbRole: "shared-worker",
          },
          mounts: [
            {
              destination: "/app/apps/api/dist",
              readOnly: false,
              source: "/repo-main/apps/api/dist",
              sourceGit: {
                branch: "main",
                commonDir: "/repo-main/.git",
                root: "/repo-main",
              },
            },
          ],
          name: "api",
          publishedPorts: [43100],
          state: "running",
        },
      ],
    });
  });

  it("reports Docker as unavailable without throwing", async () => {
    const run: DockerMountCommandRunner = async (command, args) => {
      if (command === "git") {
        if (args.includes("--show-current")) {
          return { stdout: "feature\n" };
        }
        return {
          stdout: args.includes("--show-toplevel")
            ? "/repo-feature\n"
            : "/repo-main/.git\n",
        };
      }
      const error = new Error("spawn docker ENOENT");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    };

    await expect(
      inspectWorkspaceDockerMounts({
        env: {},
        run,
        workspacePath: "/repo-feature",
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
      reason: "docker_not_installed",
      message: "Docker is not installed on this host.",
    });
  });
});
