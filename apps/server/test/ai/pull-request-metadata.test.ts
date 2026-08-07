import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDeps, LoggedWorkSessionDeps } from "../../src/types.js";
import { generatePullRequestMetadata } from "../../src/services/ai/pull-request-metadata.js";
import { createTestAppHarness } from "../helpers/test-app.js";

const piAiMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  getModel: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: () => ({
    complete: piAiMocks.complete,
    getModel: piAiMocks.getModel,
  }),
}));

async function createDeps(): Promise<{
  cleanup: () => Promise<void>;
  deps: LoggedWorkSessionDeps;
  logger: AppDeps["logger"];
}> {
  const harness = await createTestAppHarness({
    inferenceModel: "test/mock-model",
  });
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    cleanup: harness.cleanup,
    deps: { ...harness.deps, logger },
    logger,
  };
}

const metadataArgs = {
  baseBranch: "main",
  fallbackTitle: "Improve pull request creation",
  files: "M\tapps/app/src/pull-request.tsx\n",
  patch:
    "diff --git a/pull-request.tsx b/pull-request.tsx\n+Generate metadata\n",
  shortstat: "1 file changed, 1 insertion(+)\n",
};

describe("pull request metadata generation", () => {
  beforeEach(() => {
    piAiMocks.complete.mockReset();
    piAiMocks.getModel.mockReset();
    piAiMocks.getModel.mockReturnValue({ provider: "test" });
  });

  it("returns structured title and body suggestions", async () => {
    piAiMocks.complete.mockResolvedValue({
      content: [
        {
          arguments: {
            title: "Generate pull request metadata",
            body: "Generates an editable title and description from the diff.",
          },
          id: "tool_result",
          name: "result",
          type: "toolCall",
        },
      ],
    });
    const { cleanup, deps } = await createDeps();
    try {
      await expect(
        generatePullRequestMetadata(deps, metadataArgs),
      ).resolves.toEqual({
        title: "Generate pull request metadata",
        body: "Generates an editable title and description from the diff.",
      });
    } finally {
      await cleanup();
    }
  });

  it("skips inference when the branch has no committed changes", async () => {
    const { cleanup, deps } = await createDeps();
    try {
      await expect(
        generatePullRequestMetadata(deps, {
          ...metadataArgs,
          files: "",
          patch: "",
          shortstat: "",
        }),
      ).resolves.toBeNull();
      expect(piAiMocks.complete).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
