import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerSpaceCommands } from "../../commands/space.js";

describe("bb space command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerSpaceCommands(program, () => "http://server");

  it("moves a project to the selected Space", async () => {
    const patch = vi.fn(async () => ({
      id: "space_work",
      name: "Work",
      icon: "target",
      color: "blue",
      projectIds: ["project_1"],
      createdAt: 1,
      updatedAt: 2,
    }));
    stubServerApi({ "v1.spaces.:id.projects.:projectId.$patch": patch });

    await runCommand(
      ["space", "move-project", "space_work", "project_1"],
      register,
    );

    expect(patch).toHaveBeenCalledWith({
      param: { id: "space_work", projectId: "project_1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Project project_1 moved to Space space_work",
    ]);
  });
});
