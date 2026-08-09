import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectWorkspaceDockerPathActivity } from "./docker-path-activity.js";

describe("inspectWorkspaceDockerPathActivity", () => {
  it("returns the newest file", async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "bb-activity-"));
    const sourcePath = path.join(workspacePath, "apps/api/src");
    await mkdir(sourcePath, { recursive: true });
    await writeFile(path.join(sourcePath, "index.ts"), "source");

    const result = await inspectWorkspaceDockerPathActivity({
      paths: ["apps/api/src"],
      workspacePath,
    });

    expect(result.outcome).toBe("available");
    if (result.outcome !== "available") return;
    expect(result.paths[0]).toMatchObject({
      limited: false,
      newestFilePath: path.join(sourcePath, "index.ts"),
      path: "apps/api/src",
      scannedFiles: 1,
    });
  });

  it("rejects paths outside the workspace", async () => {
    const result = await inspectWorkspaceDockerPathActivity({
      paths: ["../other"],
      workspacePath: "/repo",
    });
    expect(result).toMatchObject({
      outcome: "unavailable",
      reason: "invalid_path",
    });
  });

  it("rejects a symbolic link in the requested path", async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "bb-activity-"));
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "bb-outside-"));
    await symlink(outsidePath, path.join(workspacePath, "linked"));

    await expect(
      inspectWorkspaceDockerPathActivity({
        paths: ["linked/src"],
        workspacePath,
      }),
    ).resolves.toMatchObject({
      outcome: "unavailable",
      reason: "invalid_path",
    });
  });
});
