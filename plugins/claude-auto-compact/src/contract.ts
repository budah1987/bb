import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MIN_WINDOW = 250_000;
export const MAX_WINDOW = 400_000;
export const DEFAULT_WINDOW = 300_000;

export const compactSettingsSchema = z
  .object({
    enabled: z.boolean(),
    autoCompactWindow: z.number().int().min(MIN_WINDOW).max(MAX_WINDOW),
  })
  .strict();
export type CompactSettings = z.infer<typeof compactSettingsSchema>;

export const claudeAutoCompactRpcContract = defineRpcContract({
  getSettings: {
    input: z.null(),
    output: compactSettingsSchema,
  },
  updateSettings: {
    input: compactSettingsSchema,
    output: compactSettingsSchema,
  },
});
