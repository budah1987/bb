import { z } from "zod";

/**
 * Feature flags resolved by the server and exposed to clients.
 *
 * `placeholder` is a PERMANENT, non-functional keep-alive: it lets the flag
 * system keep functioning with zero real flags. Without it the schema and type
 * would collapse to empty, so adding the next flag would mean re-deriving this
 * whole seam instead of appending one field. Add real flags alongside it; do
 * NOT remove it, and do NOT gate behavior on it.
 */
export const featureFlagsSchema = z.object({
  placeholder: z.boolean(),
  /**
   * Max events a single thread-timeline window may span.
   *
   * A window is otherwise bounded only by segment (user-message) count, which
   * is a weak bound on work: an agentic turn can be thousands of events, so a
   * thread with few user messages and a long history reprojects all of it on
   * every request and blocks the server's event loop.
   *
   * Operator escape hatch rather than a product knob — raising it far above the
   * default restores the old unbounded-in-practice behavior without a second
   * code path.
   */
  timelineWindowEventBudget: z.number().int().positive(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  placeholder: false,
  /**
   * The largest current production thread built its warm latest window in
   * 100ms at 1,500 events and 66ms at 850 events. Older rows remain available
   * through the same sequence pagination.
   */
  timelineWindowEventBudget: 850,
};
