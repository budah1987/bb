import { defineRpcContract } from "@bb/plugin-sdk";
import { z } from "zod";

export const INGESTION_CASE_STATUSES = [
  "inbox",
  "needs_context",
  "drafting",
  "ready",
  "publishing",
  "published",
  "sync_blocked",
] as const;

export const sourceKindSchema = z.enum([
  "upload",
  "pasted",
  "drive_link",
  "granola_paste",
  "url",
]);
export const sourceAuthoritySchema = z.enum(["primary", "context", "evidence"]);
export const ingestionCaseStatusSchema = z.enum(INGESTION_CASE_STATUSES);

export const ingestionDetailsSchema = z
  .object({
    date: z.string().nullable(),
    project: z.string().nullable(),
    attendees: z.array(z.string()).max(100),
    meetingType: z.string().nullable(),
  })
  .strict();

const sourceShape = {
  kind: sourceKindSchema,
  label: z.string().trim().min(1).max(240),
  authority: sourceAuthoritySchema.default("context"),
  url: z.string().url().nullable().default(null),
  content: z.string().max(1_000_000).nullable().default(null),
};

export const sourceInputSchema = z
  .object(sourceShape)
  .strict()
  .superRefine((value, context) => {
    if (value.url === null && value.content === null) {
      context.addIssue({
        code: "custom",
        message: "A source requires a URL or captured content",
        path: ["content"],
      });
    }
  });

export const ingestionSourceSchema = z
  .object({
    ...sourceShape,
    id: z.string().startsWith("ingsrc_"),
    description: z.string(),
    contentLength: z.number().int().nonnegative().nullable(),
    sha256: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.url === null &&
      value.content === null &&
      value.contentLength === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A source requires a URL or captured content",
        path: ["content"],
      });
    }
  });

export const provenanceSchema = z
  .object({
    id: z.string().startsWith("ingprov_"),
    kind: z.enum(["source", "draft", "review", "publish"]),
    message: z.string(),
    sourceId: z.string().startsWith("ingsrc_").nullable(),
    createdAt: z.string(),
  })
  .strict();

export const outputSchema = z
  .object({
    path: z.string().min(1).max(2_000),
    summary: z.string().max(2_000),
  })
  .strict();

export const draftSchema = z
  .object({
    markdown: z.string(),
    outputs: z.array(outputSchema).max(100),
    draftThreadId: z.string().nullable(),
    reviewedAt: z.string().nullable(),
  })
  .strict();

export const gitParitySchema = z
  .object({
    state: z.enum([
      "not_checked",
      "ready",
      "published",
      "blocked",
      "unavailable",
    ]),
    localHead: z.string().nullable(),
    remoteHead: z.string().nullable(),
    publishedCommit: z.string().nullable(),
    message: z.string().nullable(),
  })
  .strict();

export const ingestionCaseSchema = z
  .object({
    id: z.string().startsWith("ing_"),
    projectId: z.string().min(1),
    title: z.string(),
    summary: z.string(),
    status: ingestionCaseStatusSchema,
    details: ingestionDetailsSchema,
    sources: z.array(ingestionSourceSchema),
    provenance: z.array(provenanceSchema),
    outputs: z.array(outputSchema),
    draft: draftSchema.nullable(),
    git: gitParitySchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export const projectSummarySchema = z
  .object({ id: z.string(), name: z.string() })
  .strict();

export const bootstrapInputSchema = z
  .object({ projectId: z.string().min(1).nullable().default(null) })
  .strict();
export const bootstrapOutputSchema = z
  .object({
    cases: z.array(ingestionCaseSchema),
    projects: z.array(projectSummarySchema),
  })
  .strict();

export const createCaseInputSchema = z
  .object({
    projectId: z.string().min(1),
    title: z.string().trim().min(1).max(240),
    source: sourceInputSchema,
  })
  .strict();

export const updateCaseInputSchema = z
  .object({
    caseId: z.string().startsWith("ing_"),
    title: z.string().trim().min(1).max(240).optional(),
    summary: z.string().max(10_000).optional(),
    details: ingestionDetailsSchema.optional(),
    status: z.enum(["inbox", "needs_context"]).optional(),
  })
  .strict();

export const addSourceInputSchema = z
  .object({ caseId: z.string().startsWith("ing_"), source: sourceInputSchema })
  .strict();

export const caseIdInputSchema = z
  .object({ caseId: z.string().startsWith("ing_") })
  .strict();

export const submitDraftInputSchema = z
  .object({
    caseId: z.string().startsWith("ing_"),
    markdown: z.string().trim().min(1).max(1_000_000),
    outputs: z.array(outputSchema).min(1).max(100),
  })
  .strict();

export const publishCaseInputSchema = z
  .object({
    caseId: z.string().startsWith("ing_"),
    preserveLocalChanges: z.boolean().default(false),
  })
  .strict();

export const ingestionRpcContract = defineRpcContract({
  bootstrap: { input: bootstrapInputSchema, output: bootstrapOutputSchema },
  createCase: { input: createCaseInputSchema, output: ingestionCaseSchema },
  updateCase: { input: updateCaseInputSchema, output: ingestionCaseSchema },
  addSource: { input: addSourceInputSchema, output: ingestionCaseSchema },
  startDraft: { input: caseIdInputSchema, output: ingestionCaseSchema },
  submitDraft: { input: submitDraftInputSchema, output: ingestionCaseSchema },
  refreshCase: { input: caseIdInputSchema, output: ingestionCaseSchema },
  publishCase: { input: publishCaseInputSchema, output: ingestionCaseSchema },
});

export type IngestionCase = z.infer<typeof ingestionCaseSchema>;
export type IngestionDetails = z.infer<typeof ingestionDetailsSchema>;
export type IngestionSourceInput = z.input<typeof sourceInputSchema>;
export type IngestionSource = z.infer<typeof ingestionSourceSchema>;
export type IngestionOutput = z.infer<typeof outputSchema>;
export type GitParity = z.infer<typeof gitParitySchema>;
export type IngestionRpcContract = typeof ingestionRpcContract;
