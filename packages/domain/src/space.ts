import { z } from "zod";

export const DEFAULT_SPACE_ID = "space_default";

export const spaceIconValues = [
  "layers",
  "grid",
  "star",
  "circle",
  "zap",
  "target",
  "folder",
  "workflow",
] as const;
export const spaceIconSchema = z.enum(spaceIconValues);
export type SpaceIcon = z.infer<typeof spaceIconSchema>;

export const spaceColorValues = [
  "sage",
  "amber",
  "mulberry",
  "blue",
  "coral",
  "teal",
  "neutral",
] as const;
export const spaceColorSchema = z.enum(spaceColorValues);
export type SpaceColor = z.infer<typeof spaceColorSchema>;
