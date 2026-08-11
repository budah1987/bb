import { describe, expect, it } from "vitest";
import {
  controlWorkspaceDockerContainer,
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

describe("controlWorkspaceDockerContainer", () => {
  it("controls only containers tied to the current repository", async () => {
    const commands: string[] = [];
    const inspectJson = JSON.stringify([
      {
        Id: "container-1",
        Name: "/api",
        Config: { Image: "example/api", Labels: null },
        State: { Status: "running" },
        Mounts: [
          {
            Type: "bind",
            Source: "/repo-feature/dist",
            Destination: "/app/dist",
            RW: true,
          },
        ],
        NetworkSettings: { Ports: {} },
      },
    ]);
    const run: DockerMountCommandRunner = async (command, args) => {
      const key = [command, ...args].join(" ");
      commands.push(key);
      if (key === "docker ps --all --quiet") {
        return { stdout: "container-1\n" };
      }
      if (key === "docker inspect container-1") {
        return { stdout: inspectJson };
      }
      if (key === "docker restart container-1") {
        return { stdout: "container-1\n" };
      }
      if (command === "git") {
        if (args.includes("--show-toplevel")) {
          return { stdout: "/repo-feature\n" };
        }
        if (args.includes("--git-common-dir")) {
          return { stdout: "/repo-main/.git\n" };
        }
        return { stdout: "feature\n" };
      }
      throw new Error(`Unexpected command: ${key}`);
    };

    await expect(
      controlWorkspaceDockerContainer({
        action: "restart",
        containerId: "container-1",
        env: {},
        run,
        workspacePath: "/repo-feature",
      }),
    ).resolves.toEqual({ action: "restart", containerId: "container-1" });
    expect(commands).toContain("docker restart container-1");
  });

  it("rejects a container from another repository", async () => {
    const inspectJson = JSON.stringify([
      {
        Id: "container-foreign",
        Name: "/foreign",
        Config: { Image: "example/foreign", Labels: null },
        State: { Status: "running" },
        Mounts: [
          {
            Type: "bind",
            Source: "/foreign/dist",
            Destination: "/app/dist",
            RW: true,
          },
        ],
        NetworkSettings: { Ports: {} },
      },
    ]);
    const run: DockerMountCommandRunner = async (command, args) => {
      const key = [command, ...args].join(" ");
      if (key === "docker ps --all --quiet") {
        return { stdout: "container-foreign\n" };
      }
      if (key === "docker inspect container-foreign") {
        return { stdout: inspectJson };
      }
      if (command === "git") {
        const target = args[1];
        if (args.includes("--show-toplevel")) {
          return {
            stdout: `${target === "/foreign/dist" ? "/foreign" : "/repo-feature"}\n`,
          };
        }
        if (args.includes("--git-common-dir")) {
          return {
            stdout: `${target === "/foreign/dist" ? "/foreign/.git" : "/repo-main/.git"}\n`,
          };
        }
        return { stdout: "feature\n" };
      }
      throw new Error(`Unexpected command: ${key}`);
    };

    await expect(
      controlWorkspaceDockerContainer({
        action: "stop",
        containerId: "container-foreign",
        env: {},
        run,
        workspacePath: "/repo-feature",
      }),
    ).rejects.toThrow("does not belong to this environment");
  });
});
