import { describe, expect, it, vi } from "vitest";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread annotations command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("lists annotations with explicit server filters", async () => {
    const list = vi.fn(async () => ({ annotations: [] }));
    stubServerApi({ "v1.threads.:id.annotations.$get": list });

    await runCommand(
      [
        "thread",
        "annotations",
        "list",
        "thread-1",
        "--tab",
        "browser-1",
        "--status",
        "open",
      ],
      register,
    );

    expect(list).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      query: { browserTabId: "browser-1", status: "open" },
    });
  });

  it("sends the expected revision when resolving an annotation", async () => {
    const update = vi.fn(async () => ({
      id: "annotation-1",
      threadId: "thread-1",
      environmentId: null,
      browserTabId: "browser-1",
      url: "http://localhost:3000",
      selector: "main",
      viewport: { width: 1200, height: 800 },
      rectangle: { x: 0, y: 0, width: 1200, height: 800 },
      comment: "Reduce the spacing.",
      status: "resolved",
      revision: 4,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:01:00.000Z",
    }));
    stubServerApi({
      "v1.threads.:id.annotations.:annotationId.$patch": update,
    });

    await runCommand(
      [
        "thread",
        "annotations",
        "update",
        "annotation-1",
        "thread-1",
        "--revision",
        "3",
        "--status",
        "resolved",
      ],
      register,
    );

    expect(update).toHaveBeenCalledWith({
      param: { annotationId: "annotation-1", id: "thread-1" },
      json: { expectedRevision: 3, status: "resolved" },
    });
  });
});
