import { z } from "zod";
import {
  FILE_LIST_QUERY_MAX_LENGTH,
  gitBranchNameSchema,
  gitBranchRefClassificationSchema,
  jsonValueSchema,
  threadGitDiffResponseSchema,
  threadPullRequestSchema,
  workspaceDiffTargetSchema,
  workspaceCommitPathsSchema,
  workspaceStatusSchema,
  workspaceFolderNameSchema,
} from "@bb/domain";
import {
  githubAccountLoginSchema,
  workspaceResolutionFailureSchema,
} from "@bb/host-daemon-contract";
import { apiErrorSchema } from "../errors.js";
import {
  branchListQuerySchema,
  pathListIncludeQueryValueSchema,
} from "./shared.js";

export const environmentNameSchema = z.string().trim().min(1).max(80);

export const updateEnvironmentRequestSchema = z
  .object({
    // Omitted fields are left unchanged. `null` clears the configured value.
    githubAccountLogin: githubAccountLoginSchema.nullable(),
    mergeBaseBranch: gitBranchNameSchema.nullable(),
    name: environmentNameSchema.nullable(),
  })
  .partial()
  .refine(
    (value) =>
      value.githubAccountLogin !== undefined ||
      value.mergeBaseBranch !== undefined ||
      value.name !== undefined,
    "At least one field must be provided",
  );
export type UpdateEnvironmentRequest = z.infer<
  typeof updateEnvironmentRequestSchema
>;

export const renameEnvironmentRequestSchema = z.discriminatedUnion("target", [
  z
    .object({ target: z.literal("branch"), value: gitBranchNameSchema })
    .strict(),
  z
    .object({ target: z.literal("folder"), value: workspaceFolderNameSchema })
    .strict(),
]);
export type RenameEnvironmentRequest = z.infer<
  typeof renameEnvironmentRequestSchema
>;

/**
 * Query for searching paths in an environment's workspace. Unlike the
 * project-scoped variant this needs no `environmentId` — the environment is
 * the route param — and is project-agnostic, so it works for projectless
 * (personal) environments too.
 */
export const environmentPathsQuerySchema = z.object({
  query: z.string().min(1).max(FILE_LIST_QUERY_MAX_LENGTH).optional(),
  limit: z.string().regex(/^\d+$/).optional(),
  includeFiles: pathListIncludeQueryValueSchema,
  includeDirectories: pathListIncludeQueryValueSchema,
});
export type EnvironmentPathsQuery = z.infer<typeof environmentPathsQuerySchema>;

export const simulatorDeviceSchema = z
  .object({
    udid: z.string().min(1),
    name: z.string().min(1),
    runtime: z.string().min(1),
    state: z.enum(["Booted", "Shutdown"]),
  })
  .strict();

export const simulatorActiveSessionSchema = z
  .object({
    deviceUdid: z.string().min(1),
    deviceName: z.string().min(1),
    state: z.literal("running"),
  })
  .strict();

export const simulatorControlActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tap"),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("gesture"),
      points: z
        .array(
          z
            .object({
              type: z.enum(["begin", "move", "end"]),
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
            })
            .strict(),
        )
        .min(2)
        .max(64),
    })
    .strict(),
  z.object({ kind: z.literal("type"), text: z.string().max(10_000) }).strict(),
  z
    .object({
      kind: z.literal("button"),
      button: z.enum([
        "home",
        "swipe_home",
        "app_switcher",
        "lock",
        "siri",
        "side_button",
      ]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rotate"),
      orientation: z.enum([
        "portrait",
        "portrait_upside_down",
        "landscape_left",
        "landscape_right",
      ]),
    })
    .strict(),
]);
export type SimulatorControlAction = z.infer<
  typeof simulatorControlActionSchema
>;

export const simulatorStatusResponseSchema = z
  .object({
    supported: z.boolean(),
    message: z.string().nullable(),
    devices: z.array(simulatorDeviceSchema),
    active: simulatorActiveSessionSchema.nullable(),
  })
  .strict();
export type SimulatorStatusResponse = z.infer<
  typeof simulatorStatusResponseSchema
>;

export const simulatorAttachRequestSchema = z
  .object({ deviceUdid: z.string().min(1).optional() })
  .strict();
export type SimulatorAttachRequest = z.infer<
  typeof simulatorAttachRequestSchema
>;

export const simulatorStreamConnectionSchema = z
  .object({
    url: z.string().url(),
    token: z.string().min(32),
    expiresAt: z.number().int().positive(),
    transport: z.enum(["loopback", "tunnel"]),
  })
  .strict();
export type SimulatorStreamConnection = z.infer<
  typeof simulatorStreamConnectionSchema
>;

export const simulatorAttachResponseSchema = z
  .object({
    session: simulatorActiveSessionSchema,
    stream: simulatorStreamConnectionSchema,
  })
  .strict();
export type SimulatorAttachResponse = z.infer<
  typeof simulatorAttachResponseSchema
>;

export const simulatorLeaseResponseSchema = simulatorStreamConnectionSchema;
export type SimulatorLeaseResponse = z.infer<
  typeof simulatorLeaseResponseSchema
>;

export const simulatorControlRequestSchema = z
  .object({ action: simulatorControlActionSchema })
  .strict();
export type SimulatorControlRequest = z.infer<
  typeof simulatorControlRequestSchema
>;

export const simulatorControlResponseSchema = z
  .object({ ok: z.literal(true) })
  .strict();
export type SimulatorControlResponse = z.infer<
  typeof simulatorControlResponseSchema
>;

export const simulatorStopResponseSchema = z
  .object({ stopped: z.boolean(), deviceUdid: z.string().min(1).nullable() })
  .strict();
export type SimulatorStopResponse = z.infer<typeof simulatorStopResponseSchema>;

export const simulatorAccessibilityResponseSchema = z
  .object({ tree: jsonValueSchema })
  .strict();
export type SimulatorAccessibilityResponse = z.infer<
  typeof simulatorAccessibilityResponseSchema
>;

export const simulatorScreenshotResponseSchema = z
  .object({ dataBase64: z.string(), mimeType: z.literal("image/png") })
  .strict();
export type SimulatorScreenshotResponse = z.infer<
  typeof simulatorScreenshotResponseSchema
>;

export const environmentDiffBranchesQuerySchema = branchListQuerySchema.extend({
  selectedBranch: gitBranchNameSchema.optional(),
});
export type EnvironmentDiffBranchesQuery = z.infer<
  typeof environmentDiffBranchesQuerySchema
>;

export const environmentDiffBranchesResponseSchema = z.object({
  /** Local branches under refs/heads, safe for checkout and write targets. */
  branches: z.array(z.string()),
  branchesTruncated: z.boolean(),
  /** Remote-tracking branches under refs/remotes, for base/diff selection. */
  remoteBranches: z.array(z.string()),
  remoteBranchesTruncated: z.boolean(),
  selectedBranch: gitBranchRefClassificationSchema.nullable(),
});
export type EnvironmentDiffBranchesResponse = z.infer<
  typeof environmentDiffBranchesResponseSchema
>;

const mergeBaseBranchQuerySchema = z
  .string("A merge base branch is required")
  .pipe(gitBranchNameSchema);

export const environmentStatusQuerySchema = z.object({
  mergeBaseBranch: mergeBaseBranchQuerySchema.optional(),
});
export type EnvironmentStatusQuery = z.infer<
  typeof environmentStatusQuerySchema
>;

export const environmentDockerProvenanceMountSchema = z
  .object({
    checkoutRoot: z.string().min(1),
    destination: z.string().min(1),
    readOnly: z.boolean(),
    source: z.string().min(1),
  })
  .strict();
export type EnvironmentDockerProvenanceMount = z.infer<
  typeof environmentDockerProvenanceMountSchema
>;

export const environmentDockerServiceSchema = z
  .object({
    checkoutStatus: z.enum([
      "current_checkout",
      "wrong_checkout",
      "declared_shared",
      "ambiguous",
      "unknown",
    ]),
    id: z.string().min(1),
    image: z.string().min(1),
    kind: z.enum(["server", "background_service", "shared_worker"]),
    mounts: z.array(environmentDockerProvenanceMountSchema),
    name: z.string().min(1),
    ownerBranch: z.string().min(1).nullable(),
    ownerCheckoutRoot: z.string().min(1).nullable(),
    publishedPorts: z.array(z.number().int().min(1).max(65_535)),
    state: z.string().min(1),
  })
  .strict();
export type EnvironmentDockerService = z.infer<
  typeof environmentDockerServiceSchema
>;

export const environmentDockerProvenanceResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        environmentPath: z.string().min(1),
        services: z.array(environmentDockerServiceSchema),
      })
      .strict(),
    z
      .object({
        outcome: z.literal("unavailable"),
        reason: z.enum(["docker_not_installed", "docker_unavailable"]),
        message: z.string().min(1),
      })
      .strict(),
  ],
);
export type EnvironmentDockerProvenanceResponse = z.infer<
  typeof environmentDockerProvenanceResponseSchema
>;

export const environmentDockerPathActivitySchema = z
  .object({
    limited: z.boolean(),
    newestFileMtimeMs: z.number().nonnegative().nullable(),
    newestFilePath: z.string().min(1).nullable(),
    path: z.string().min(1),
    scannedFiles: z.number().int().nonnegative(),
  })
  .strict();

export const environmentDockerServiceActivitySchema = z
  .object({
    build: environmentDockerPathActivitySchema.nullable(),
    freshness: z.enum(["fresh", "stale", "missing_build", "unknown"]),
    serviceId: z.string().min(1),
    source: environmentDockerPathActivitySchema.nullable(),
  })
  .strict();
export type EnvironmentDockerServiceActivity = z.infer<
  typeof environmentDockerServiceActivitySchema
>;

export const environmentDockerActivityResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        activities: z.array(environmentDockerServiceActivitySchema),
        outcome: z.literal("available"),
      })
      .strict(),
    z
      .object({
        message: z.string().min(1),
        outcome: z.literal("unavailable"),
      })
      .strict(),
  ],
);
export type EnvironmentDockerActivityResponse = z.infer<
  typeof environmentDockerActivityResponseSchema
>;

export const environmentDockerControlRequestSchema = z
  .object({
    action: z.enum(["restart", "stop"]),
    containerId: z.string().regex(/^[a-f0-9]{12,64}$/u),
  })
  .strict();
export type EnvironmentDockerControlRequest = z.infer<
  typeof environmentDockerControlRequestSchema
>;

export const environmentDockerControlResponseSchema = z
  .object({
    action: z.enum(["restart", "stop"]),
    containerId: z.string().min(1),
  })
  .strict();
export type EnvironmentDockerControlResponse = z.infer<
  typeof environmentDockerControlResponseSchema
>;

export const environmentPreviewProviderSchema = z
  .object({
    branchUrl: z.string().url().nullable(),
    deploymentUrl: z.string().url().nullable(),
    environment: z.string().min(1).nullable(),
    framePolicy: z.enum(["allowed", "blocked", "unknown"]),
    frameReason: z.string().min(1).nullable(),
    id: z.string().min(1),
    kind: z.enum(["local", "deployment"]),
    label: z.string().min(1),
    logUrl: z.string().url().nullable(),
    port: z.number().int().min(1).max(65535).nullable(),
    shared: z.boolean(),
    source: z.enum(["docker", "github", "terminal"]),
    state: z.enum(["ready", "building", "failed", "unknown"]),
    updatedAt: z.string().min(1).nullable(),
    url: z.string().url().nullable(),
  })
  .strict();
export type EnvironmentPreviewProvider = z.infer<
  typeof environmentPreviewProviderSchema
>;

export const environmentPreviewsResponseSchema = z
  .object({
    issues: z.array(
      z
        .object({
          message: z.string().min(1),
          source: z.enum(["docker", "github", "terminal"]),
        })
        .strict(),
    ),
    providers: z.array(environmentPreviewProviderSchema),
  })
  .strict();
export type EnvironmentPreviewsResponse = z.infer<
  typeof environmentPreviewsResponseSchema
>;

export const startEnvironmentDevServerRequestSchema = z
  .object({
    command: z.string().trim().min(1).max(10_000),
    preferredPort: z.number().int().min(1024).max(65535).optional(),
    threadId: z.string().min(1),
    title: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((request) => request.command.includes("{port}"), {
    message: "command must include the {port} placeholder",
    path: ["command"],
  });
export type StartEnvironmentDevServerRequest = z.infer<
  typeof startEnvironmentDevServerRequestSchema
>;

export const environmentPreviewPortRequestSchema = z
  .object({ port: z.number().int().min(1).max(65535) })
  .strict();
export type EnvironmentPreviewPortRequest = z.infer<
  typeof environmentPreviewPortRequestSchema
>;

export const environmentPreviewShareResponseSchema = z
  .object({ port: z.number().int().min(1).max(65535), url: z.string().url() })
  .strict();
export type EnvironmentPreviewShareResponse = z.infer<
  typeof environmentPreviewShareResponseSchema
>;

export const environmentPreviewUnshareResponseSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    shared: z.literal(false),
  })
  .strict();
export type EnvironmentPreviewUnshareResponse = z.infer<
  typeof environmentPreviewUnshareResponseSchema
>;

export const environmentPreviewBypassRequestSchema = z
  .object({
    providerId: z.string().min(1),
    secret: z.string().trim().min(1).max(4096),
  })
  .strict();
export type EnvironmentPreviewBypassRequest = z.infer<
  typeof environmentPreviewBypassRequestSchema
>;

export const environmentPreviewBypassResponseSchema = z
  .object({ url: z.string().url() })
  .strict();
export type EnvironmentPreviewBypassResponse = z.infer<
  typeof environmentPreviewBypassResponseSchema
>;

export const environmentDiffQuerySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("uncommitted"),
  }),
  z.object({
    target: z.literal("branch_committed"),
    mergeBaseBranch: mergeBaseBranchQuerySchema,
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseBranch: mergeBaseBranchQuerySchema,
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
  }),
]);
export type EnvironmentDiffQuery = z.infer<typeof environmentDiffQuerySchema>;

const diffFileSideSchema = z.enum(["old", "new"]);

const mergeBaseRefQuerySchema = z.string().regex(/^[0-9a-f]{4,40}$/iu);

/**
 * Query for fetching a single file's contents at one side of a diff target.
 * Used by the diff card to reparse the card's patch with full old/new contents
 * so `@pierre/diffs` can render expand-context buttons between hunks.
 *
 * For `branch_committed` / `all`, callers pass the resolved merge-base SHA
 * (`mergeBaseRef`, surfaced by `workspace.diff`) rather than the branch name
 * — the diff itself was computed against that SHA, so reading the old side
 * from the same SHA keeps the file content aligned with the hunk line
 * numbers. Reading from the branch tip is wrong whenever the branch has
 * moved past the merge-base since the file existed there.
 */
export const environmentDiffFileQuerySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("uncommitted"),
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("branch_committed"),
    mergeBaseRef: mergeBaseRefQuerySchema,
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("all"),
    mergeBaseRef: mergeBaseRefQuerySchema,
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
  z.object({
    target: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
    path: z.string().min(1),
    side: diffFileSideSchema,
  }),
]);
export type EnvironmentDiffFileQuery = z.infer<
  typeof environmentDiffFileQuerySchema
>;

export const environmentDiffFileResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
});
export type EnvironmentDiffFileResponse = z.infer<
  typeof environmentDiffFileResponseSchema
>;

export const environmentArchiveThreadsResponseSchema = z.object({
  ok: z.literal(true),
  archivedThreadIds: z.array(z.string().min(1)),
});
export type EnvironmentArchiveThreadsResponse = z.infer<
  typeof environmentArchiveThreadsResponseSchema
>;

export const pullRequestMergeMethodSchema = z.enum([
  "merge",
  "squash",
  "rebase",
]);
export type PullRequestMergeMethod = z.infer<
  typeof pullRequestMergeMethodSchema
>;

export const environmentActionTypeSchema = z.enum([
  "commit",
  "squash_merge",
  "publish_to_main",
  "update_from_main",
  "pull_request_metadata",
  "pull_request_create",
  "pull_request_ready",
  "pull_request_merge",
  "pull_request_draft",
  "pull_request_checks_rerun",
]);

export const squashMergeOptionsSchema = z
  .object({
    mergeBaseBranch: gitBranchNameSchema,
  })
  .strict();
export type SquashMergeOptions = z.infer<typeof squashMergeOptionsSchema>;

export const publishToMainOptionsSchema = z
  .object({
    preserveTargetChanges: z.boolean().default(false),
  })
  .strict()
  .default({ preserveTargetChanges: false });
export type PublishToMainOptions = z.infer<typeof publishToMainOptionsSchema>;

export const updateFromMainOptionsSchema = z.object({}).strict().default({});
export type UpdateFromMainOptions = z.infer<typeof updateFromMainOptionsSchema>;

export const pullRequestMergeOptionsSchema = z
  .object({
    method: pullRequestMergeMethodSchema,
  })
  .strict();
export type PullRequestMergeOptions = z.infer<
  typeof pullRequestMergeOptionsSchema
>;

export const pullRequestCreateOptionsSchema = z
  .object({
    baseBranch: gitBranchNameSchema,
    body: z.string(),
    draft: z.boolean(),
    title: z.string().trim().min(1),
  })
  .strict();
export type PullRequestCreateOptions = z.infer<
  typeof pullRequestCreateOptionsSchema
>;

export const pullRequestMetadataOptionsSchema = z
  .object({
    baseBranch: gitBranchNameSchema,
    fallbackTitle: z.string().trim().min(1),
  })
  .strict();
export type PullRequestMetadataOptions = z.infer<
  typeof pullRequestMetadataOptionsSchema
>;

export const pullRequestChecksRerunOptionsSchema = z.discriminatedUnion(
  "scope",
  [
    z.object({ scope: z.literal("failed") }).strict(),
    z
      .object({
        scope: z.literal("check"),
        checkName: z.string().trim().min(1),
      })
      .strict(),
  ],
);
export type PullRequestChecksRerunOptions = z.infer<
  typeof pullRequestChecksRerunOptionsSchema
>;

export const commitOptionsSchema = z
  .object({
    paths: workspaceCommitPathsSchema,
  })
  .strict();
export type CommitOptions = z.infer<typeof commitOptionsSchema>;

export const environmentActionRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("commit"),
      options: commitOptionsSchema.optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("squash_merge"),
      options: squashMergeOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("publish_to_main"),
      options: publishToMainOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("update_from_main"),
      options: updateFromMainOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_metadata"),
      options: pullRequestMetadataOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_create"),
      options: pullRequestCreateOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_ready"),
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_merge"),
      options: pullRequestMergeOptionsSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_draft"),
    })
    .strict(),
  z
    .object({
      action: z.literal("pull_request_checks_rerun"),
      options: pullRequestChecksRerunOptionsSchema,
    })
    .strict(),
]);
export type EnvironmentActionRequest = z.infer<
  typeof environmentActionRequestSchema
>;

export const commitActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("commit"),
  message: z.string().min(1),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
export type CommitActionResponse = z.infer<typeof commitActionResponseSchema>;

export const squashMergeActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("squash_merge"),
  merged: z.boolean(),
  message: z.string().min(1),
  commitSha: z.string().min(1),
  commitSubject: z.string().min(1),
});
export type SquashMergeActionResponse = z.infer<
  typeof squashMergeActionResponseSchema
>;

export const publishToMainActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("publish_to_main"),
  message: z.string().min(1),
  sourceBranch: gitBranchNameSchema,
  targetBranch: z.literal("main"),
  sourceCommitSha: z.string().min(1),
  remoteTargetBeforeSha: z.string().min(1),
  remoteTargetAfterSha: z.string().min(1),
  localTargetBeforeSha: z.string().min(1),
  localTargetAfterSha: z.string().min(1),
  preservedTargetChangesCommitSha: z.string().min(1).nullable(),
});
export type PublishToMainActionResponse = z.infer<
  typeof publishToMainActionResponseSchema
>;

export const updateFromMainActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("update_from_main"),
  message: z.string().min(1),
  outcome: z.enum(["updated", "already_current"]),
  sourceBranch: gitBranchNameSchema,
  targetBranch: z.literal("main"),
  previousSha: z.string().min(1),
  currentSha: z.string().min(1),
  targetSha: z.string().min(1),
  rebasedCommitCount: z.number().int().nonnegative(),
});
export type UpdateFromMainActionResponse = z.infer<
  typeof updateFromMainActionResponseSchema
>;

export const pullRequestMetadataActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_metadata"),
  title: z.string().min(1),
  body: z.string(),
  generated: z.boolean(),
});
export type PullRequestMetadataActionResponse = z.infer<
  typeof pullRequestMetadataActionResponseSchema
>;

export const pullRequestCreateActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_create"),
  message: z.string().min(1),
  pullRequest: threadPullRequestSchema,
});
export type PullRequestCreateActionResponse = z.infer<
  typeof pullRequestCreateActionResponseSchema
>;

export const pullRequestReadyActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_ready"),
  message: z.string().min(1),
});
export type PullRequestReadyActionResponse = z.infer<
  typeof pullRequestReadyActionResponseSchema
>;

export const pullRequestMergeActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_merge"),
  method: pullRequestMergeMethodSchema,
  message: z.string().min(1),
});
export type PullRequestMergeActionResponse = z.infer<
  typeof pullRequestMergeActionResponseSchema
>;

export const pullRequestDraftActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_draft"),
  message: z.string().min(1),
});
export type PullRequestDraftActionResponse = z.infer<
  typeof pullRequestDraftActionResponseSchema
>;

export const pullRequestChecksRerunActionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("pull_request_checks_rerun"),
  message: z.string().min(1),
  rerunCount: z.number().int().positive(),
});
export type PullRequestChecksRerunActionResponse = z.infer<
  typeof pullRequestChecksRerunActionResponseSchema
>;

export const environmentActionResponseSchema = z.discriminatedUnion("action", [
  commitActionResponseSchema,
  squashMergeActionResponseSchema,
  publishToMainActionResponseSchema,
  updateFromMainActionResponseSchema,
  pullRequestMetadataActionResponseSchema,
  pullRequestCreateActionResponseSchema,
  pullRequestReadyActionResponseSchema,
  pullRequestMergeActionResponseSchema,
  pullRequestDraftActionResponseSchema,
  pullRequestChecksRerunActionResponseSchema,
]);
export type EnvironmentActionResponse = z.infer<
  typeof environmentActionResponseSchema
>;

export const environmentActionFailureDetailsSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("commit_failed"),
      errorMessage: z.string(),
    }),
    z.object({
      kind: z.literal("commit_selection_stale"),
    }),
    z.object({
      kind: z.literal("squash_merge_conflict"),
      conflictFiles: z.array(z.string()),
    }),
    z.object({
      kind: z.literal("squash_merge_commit_failed"),
      stage: z.literal("squash_commit"),
      errorMessage: z.string(),
    }),
    z.object({
      kind: z.literal("squash_merge_dirty_worktree"),
    }),
    z.object({
      kind: z.literal("publish_to_main_blocked"),
      reason: z.enum([
        "source_detached",
        "source_dirty",
        "target_checkout_missing",
        "target_checkout_changed",
        "target_dirty",
        "target_diverged",
        "target_merge_conflict",
        "source_not_ahead",
        "source_not_descendant",
      ]),
      sourceBranch: gitBranchNameSchema.nullable(),
      targetBranch: z.literal("main"),
      sourceCommitSha: z.string().min(1).nullable(),
      remoteTargetSha: z.string().min(1).nullable(),
      localTargetSha: z.string().min(1).nullable(),
      conflictFiles: z.array(z.string().min(1)),
    }),
    z.object({
      kind: z.literal("update_from_main_blocked"),
      reason: z.enum([
        "source_detached",
        "source_dirty",
        "source_is_target",
        "rebase_conflict",
      ]),
      sourceBranch: gitBranchNameSchema.nullable(),
      targetBranch: z.literal("main"),
      previousSha: z.string().min(1).nullable(),
      targetSha: z.string().min(1).nullable(),
      conflictFiles: z.array(z.string().min(1)),
    }),
    z.object({
      kind: z.literal("workspace_busy"),
      action: z.literal("update_from_main"),
      reason: z.literal("active_threads"),
    }),
    z.object({
      kind: z.literal("workspace_unavailable"),
      failure: workspaceResolutionFailureSchema,
    }),
  ],
);
export type EnvironmentActionFailureDetails = z.infer<
  typeof environmentActionFailureDetailsSchema
>;

export const environmentActionApiErrorSchema = apiErrorSchema.extend({
  details: environmentActionFailureDetailsSchema.optional(),
});
export type EnvironmentActionApiError = z.infer<
  typeof environmentActionApiErrorSchema
>;

export const environmentWorkspaceNotApplicableReasonSchema = z.enum([
  "non_git_environment",
]);
export type EnvironmentWorkspaceNotApplicableReason = z.infer<
  typeof environmentWorkspaceNotApplicableReasonSchema
>;

const environmentWorkspaceNotApplicableOutcomeSchema = z
  .object({
    outcome: z.literal("not_applicable"),
    reason: environmentWorkspaceNotApplicableReasonSchema,
    message: z.string().min(1),
  })
  .strict();

export const environmentStatusResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      workspace: workspaceStatusSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);

/**
 * Structured pull-request lookup outcome. "absent" is a real answer — the
 * host checked and the branch has no PR (non-git environments resolve to
 * "absent" without a daemon call). "unavailable" means the lookup itself
 * failed (gh missing, not authenticated, timeout, unreachable workspace), so
 * callers must not render it as "no PR exists".
 */
export const environmentPullRequestResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        pullRequest: threadPullRequestSchema,
      })
      .strict(),
    z.object({ outcome: z.literal("absent") }).strict(),
    z
      .object({
        outcome: z.literal("unavailable"),
        message: z.string().min(1),
      })
      .strict(),
  ],
);
export type EnvironmentPullRequestResponse = z.infer<
  typeof environmentPullRequestResponseSchema
>;

export const environmentDiffResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      diff: threadGitDiffResponseSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: workspaceResolutionFailureSchema,
    })
    .strict(),
]);
export type EnvironmentDiffResponse = z.infer<
  typeof environmentDiffResponseSchema
>;

/**
 * Canonical git change-kind, covering the full `git diff --name-status`
 * taxonomy. Both producers map into this single type: the daemon's
 * `--name-status` letters (server-side, via `letterToChangeKind`) and the
 * frontend's patch-derived `getGitDiffFileChangeKind`. `copied` and
 * `type_changed` are only producible from name-status; the @pierre/diffs
 * patch parser never yields them.
 */
export const gitDiffFileChangeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
]);
export type GitDiffFileChangeKind = z.infer<typeof gitDiffFileChangeKindSchema>;

/**
 * Map a single `git diff --name-status` status letter to a canonical change
 * kind. Git emits a similarity score for renames/copies (e.g. `R100`, `C75`),
 * so only the leading letter is significant; callers pass that letter. Throws
 * on an unrecognized letter — name-status output is a validated boundary, so
 * an unknown code is a bug, not a value to silently default.
 */
export function letterToChangeKind({
  letter,
}: {
  letter: string;
}): GitDiffFileChangeKind {
  switch (letter) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type_changed";
    default:
      throw new Error(`Unrecognized git name-status letter: ${letter}`);
  }
}

/** Max paths accepted per `/environments/:id/diff/patch` request. */
export const DIFF_PATCH_MAX_PATHS_PER_REQUEST = 50;

/**
 * One entry per changed file — the diff tab's table of contents. Carries no
 * patch text; patches are fetched separately and on demand via `/diff/patch`.
 */
export const diffFileEntrySchema = z.object({
  /** New path (or the path itself for a delete). */
  path: z.string(),
  /** Rename/copy source; null when the file is not a rename or copy. */
  previousPath: z.string().nullable(),
  changeKind: gitDiffFileChangeKindSchema,
  /** From `--numstat`; 0 for binary files. */
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  /**
   * Whether the entry originates from an untracked working-tree file. Drives
   * the daemon's alternate-index patch handling.
   */
  origin: z.enum(["tracked", "untracked"]),
  /** Server-computed tiering decision. */
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
});
export type DiffFileEntry = z.infer<typeof diffFileEntrySchema>;

export const diffPatchEntrySchema = z.object({
  path: z.string(),
  /** Unified diff for just this file. */
  patch: z.string(),
  /** True when the patch exceeded the per-file byte budget and was tail-cut. */
  truncated: z.boolean(),
});
export type DiffPatchEntry = z.infer<typeof diffPatchEntrySchema>;

export const environmentDiffFilesResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        files: z.array(diffFileEntrySchema),
        /** True when the response contains only the bounded leading file slice. */
        truncated: z.boolean(),
        shortstat: z.string(),
        /** Required + nullable: null = no merge-base for the current target. */
        mergeBaseRef: z.string().nullable(),
        /**
         * Patches for the first screen of `auto`-tier files, shipped with the
         * TOC so initial content paints in one round-trip (no separate
         * `/diff/patch` hop). Bounded by the server's initial-patch budget;
         * the rest load on demand as the list scrolls. Empty when the diff has
         * no `auto` files.
         */
        initialPatches: z.array(diffPatchEntrySchema),
      })
      .strict(),
    environmentWorkspaceNotApplicableOutcomeSchema,
    z
      .object({
        outcome: z.literal("unavailable"),
        failure: workspaceResolutionFailureSchema,
      })
      .strict(),
  ],
);
export type EnvironmentDiffFilesResponse = z.infer<
  typeof environmentDiffFilesResponseSchema
>;

export const environmentDiffPatchResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        patches: z.array(diffPatchEntrySchema),
      })
      .strict(),
    environmentWorkspaceNotApplicableOutcomeSchema,
    z
      .object({
        outcome: z.literal("unavailable"),
        failure: workspaceResolutionFailureSchema,
      })
      .strict(),
  ],
);
export type EnvironmentDiffPatchResponse = z.infer<
  typeof environmentDiffPatchResponseSchema
>;

/**
 * Body for `POST /diff/patch`: the diff target plus the list of new paths whose
 * patches the client wants. A POST (not GET) because the repeated `paths` array
 * cannot survive flat query parsing. The client supplies only new paths; the
 * server re-derives each file's rename/copy pairing (`previousPath`) from its
 * own TOC.
 */
export const environmentDiffPatchRequestSchema = z
  .object({
    target: workspaceDiffTargetSchema,
    paths: z
      .array(z.string().min(1))
      .min(1)
      .max(DIFF_PATCH_MAX_PATHS_PER_REQUEST),
  })
  .strict();
export type EnvironmentDiffPatchRequest = z.infer<
  typeof environmentDiffPatchRequestSchema
>;

export type EnvironmentStatusResponse = z.infer<
  typeof environmentStatusResponseSchema
>;
