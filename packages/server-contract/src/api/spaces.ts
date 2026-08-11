import { z } from "zod";
import { spaceColorSchema, spaceIconSchema } from "@bb/domain";

export const spaceResponseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    icon: spaceIconSchema,
    color: spaceColorSchema,
    projectIds: z.array(z.string().min(1)),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type SpaceResponse = z.infer<typeof spaceResponseSchema>;

export const createSpaceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    icon: spaceIconSchema,
    color: spaceColorSchema,
  })
  .strict();
export type CreateSpaceRequest = z.infer<typeof createSpaceRequestSchema>;

export const updateSpaceRequestSchema = createSpaceRequestSchema;
export type UpdateSpaceRequest = z.infer<typeof updateSpaceRequestSchema>;

export const deleteSpaceRequestSchema = z
  .object({
    destinationSpaceId: z.string().min(1).nullable(),
  })
  .strict();
export type DeleteSpaceRequest = z.infer<typeof deleteSpaceRequestSchema>;

export const deleteSpaceResponseSchema = z
  .object({
    ok: z.literal(true),
    movedProjectIds: z.array(z.string().min(1)),
  })
  .strict();
export type DeleteSpaceResponse = z.infer<typeof deleteSpaceResponseSchema>;
