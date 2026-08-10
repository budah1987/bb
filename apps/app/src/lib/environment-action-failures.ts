import type { EnvironmentActionFailureDetails } from "@bb/server-contract";
import { environmentActionFailureDetailsSchema } from "@bb/server-contract";
import { BbHttpError } from "@/lib/sdk";

/**
 * Narrows an environment-action rejection to the typed failure the server
 * attaches under `details`. Returns undefined for transport errors and for
 * responses that carry no recognized detail.
 */
export function toEnvironmentActionFailureDetails(
  error: unknown,
): EnvironmentActionFailureDetails | undefined {
  if (
    !(error instanceof BbHttpError) ||
    typeof error.body !== "object" ||
    error.body === null
  ) {
    return undefined;
  }
  if (!("details" in error.body)) {
    return undefined;
  }

  const result = environmentActionFailureDetailsSchema.safeParse(
    error.body.details,
  );
  return result.success ? result.data : undefined;
}
