import { z } from "zod";

/**
 * The scratchpad is a single short field, not a document: it exists to hold one
 * passing thought next to the conversation. The cap is enforced here rather
 * than in the textarea so the CLI and SDK hit the same wall as the UI.
 */
export const THREAD_SCRATCHPAD_MAX_LENGTH = 350;

/**
 * Recaps are generated with a structured single-field output bounded to roughly
 * this length. The schema cap is deliberately looser than the prompt's target
 * so a slightly long generation is stored rather than thrown away.
 */
export const THREAD_RECAP_MAX_LENGTH = 1_024;

export const threadNotesResponseSchema = z
  .object({
    /** Generated prose; null until the first successful generation. */
    recapBody: z.string().max(THREAD_RECAP_MAX_LENGTH).nullable(),
    /** True once the user has opened the recap on this thread. */
    recapEnabled: z.boolean(),
    recapGeneratedAt: z.number().int().nonnegative().nullable(),
    /**
     * Thread event sequence the recap reflects. Clients compare this against
     * the thread's current sequence to render a staleness affordance instead of
     * presenting an out-of-date recap as current.
     */
    recapSourceSeq: z.number().int().nonnegative().nullable(),
    scratchpad: z.string().max(THREAD_SCRATCHPAD_MAX_LENGTH),
  })
  .strict();
export type ThreadNotesResponse = z.infer<typeof threadNotesResponseSchema>;

export const generateThreadRecapRequestSchema = z
  .object({
    /**
     * Regenerate even when the stored recap already reflects the thread's
     * current event sequence. Without it a current recap is returned as-is, so
     * a client can call this route freely without paying for inference.
     */
    force: z.boolean().default(false),
  })
  .strict();
export type GenerateThreadRecapRequest = z.infer<
  typeof generateThreadRecapRequestSchema
>;

export const updateThreadScratchpadRequestSchema = z
  .object({
    scratchpad: z.string().max(THREAD_SCRATCHPAD_MAX_LENGTH),
  })
  .strict();
export type UpdateThreadScratchpadRequest = z.infer<
  typeof updateThreadScratchpadRequestSchema
>;
