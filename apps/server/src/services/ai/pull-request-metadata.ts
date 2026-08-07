import { renderTemplate } from "@bb/templates";
import { Type } from "@earendil-works/pi-ai";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { InferenceTimeoutError, inferenceComplete } from "./inference.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

const pullRequestMetadataSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 72 }),
  body: Type.String({ maxLength: 10_000 }),
});

const PULL_REQUEST_METADATA_TIMEOUT_MS = 8_000;

interface GeneratePullRequestMetadataArgs {
  baseBranch: string;
  fallbackTitle: string;
  shortstat: string;
  files: string;
  patch: string;
}

export interface GeneratedPullRequestMetadata {
  title: string;
  body: string;
}

export async function generatePullRequestMetadata(
  deps: LoggedWorkSessionDeps,
  args: GeneratePullRequestMetadataArgs,
): Promise<GeneratedPullRequestMetadata | null> {
  if (
    args.shortstat.trim().length === 0 &&
    args.files.trim().length === 0 &&
    args.patch.trim().length === 0
  ) {
    return null;
  }

  try {
    const result = await inferenceComplete(deps, {
      prompt: renderTemplate("generatePullRequestMetadata", args),
      schema: pullRequestMetadataSchema,
      timeoutMs: PULL_REQUEST_METADATA_TIMEOUT_MS,
    });
    const title = result?.title.trim() ?? "";
    return title.length > 0 ? { title, body: result?.body.trim() ?? "" } : null;
  } catch (error) {
    if (error instanceof InferenceTimeoutError) {
      deps.logger.info(
        { timeoutMs: error.timeoutMs },
        "Pull request metadata inference timed out",
      );
      return null;
    }
    deps.logger.warn(
      runtimeErrorLogFields(deps.config, error),
      "Failed to generate pull request metadata",
    );
    return null;
  }
}
