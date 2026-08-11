import { z } from "zod";

export const BROWSER_ANNOTATION_URL_MAX_LENGTH = 4_096;
export const BROWSER_ANNOTATION_SELECTOR_MAX_LENGTH = 2_048;
export const BROWSER_ANNOTATION_COMMENT_MAX_LENGTH = 8_000;
export const BROWSER_ANNOTATION_BATCH_MAX_LENGTH = 50;

export const browserAnnotationStatusSchema = z.enum([
  "open",
  "sent",
  "resolved",
]);
export type BrowserAnnotationStatus = z.infer<
  typeof browserAnnotationStatusSchema
>;

const browserAnnotationViewportSchema = z
  .object({
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

const browserAnnotationRectangleSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

export const browserAnnotationSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    environmentId: z.string().min(1).nullable(),
    browserTabId: z.string().min(1).max(4_096),
    url: z.string().max(BROWSER_ANNOTATION_URL_MAX_LENGTH),
    selector: z.string().max(BROWSER_ANNOTATION_SELECTOR_MAX_LENGTH),
    viewport: browserAnnotationViewportSchema,
    rectangle: browserAnnotationRectangleSchema,
    comment: z.string().min(1).max(BROWSER_ANNOTATION_COMMENT_MAX_LENGTH),
    status: browserAnnotationStatusSchema,
    revision: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type BrowserAnnotation = z.infer<typeof browserAnnotationSchema>;

export const browserAnnotationListQuerySchema = z
  .object({
    browserTabId: z.string().min(1).max(4_096).optional(),
    status: browserAnnotationStatusSchema.optional(),
  })
  .strict();
export type BrowserAnnotationListQuery = z.infer<
  typeof browserAnnotationListQuerySchema
>;

export const browserAnnotationListResponseSchema = z
  .object({ annotations: z.array(browserAnnotationSchema) })
  .strict();
export type BrowserAnnotationListResponse = z.infer<
  typeof browserAnnotationListResponseSchema
>;

export const createBrowserAnnotationRequestSchema = z
  .object({
    environmentId: z.string().min(1).nullable(),
    browserTabId: z.string().min(1).max(4_096),
    url: z.string().max(BROWSER_ANNOTATION_URL_MAX_LENGTH),
    selector: z.string().max(BROWSER_ANNOTATION_SELECTOR_MAX_LENGTH),
    viewport: browserAnnotationViewportSchema,
    rectangle: browserAnnotationRectangleSchema,
    comment: z
      .string()
      .trim()
      .min(1)
      .max(BROWSER_ANNOTATION_COMMENT_MAX_LENGTH),
    status: browserAnnotationStatusSchema.default("open"),
  })
  .strict();
export type CreateBrowserAnnotationRequest = z.infer<
  typeof createBrowserAnnotationRequestSchema
>;

export const updateBrowserAnnotationRequestSchema = z
  .object({
    comment: z
      .string()
      .trim()
      .min(1)
      .max(BROWSER_ANNOTATION_COMMENT_MAX_LENGTH)
      .optional(),
    expectedRevision: z.number().int().positive(),
    status: browserAnnotationStatusSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.comment !== undefined || value.status !== undefined,
    "Provide comment or status",
  );
export type UpdateBrowserAnnotationRequest = z.infer<
  typeof updateBrowserAnnotationRequestSchema
>;

export const deleteBrowserAnnotationQuerySchema = z
  .object({ expectedRevision: z.coerce.number().int().positive() })
  .strict();
export type DeleteBrowserAnnotationQuery = z.infer<
  typeof deleteBrowserAnnotationQuerySchema
>;

export const clearBrowserAnnotationsRequestSchema = z
  .object({
    browserTabId: z.string().min(1).max(4_096).nullable(),
    ids: z
      .array(z.string().min(1))
      .max(BROWSER_ANNOTATION_BATCH_MAX_LENGTH)
      .nullable(),
  })
  .strict();
export type ClearBrowserAnnotationsRequest = z.infer<
  typeof clearBrowserAnnotationsRequestSchema
>;

export interface ClearBrowserAnnotationsResponse {
  deleted: number;
}
