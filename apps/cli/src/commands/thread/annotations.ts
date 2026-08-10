import { Command } from "commander";
import {
  browserAnnotationStatusSchema,
  type BrowserAnnotation,
  type BrowserAnnotationStatus,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import { outputJson, printContextLabel, type ResolvedId } from "../helpers.js";

interface CommonOptions {
  json?: boolean;
}

function resolveTarget(id: string | undefined): ResolvedId {
  const explicit = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: id,
  });
  if (explicit !== undefined) return { id: explicit, source: "arg" };
  const context = resolveContextThreadId();
  if (context !== undefined) return { id: context, source: "env" };
  throw new Error(
    "Missing thread ID. Pass <threadId> or run inside a BB thread.",
  );
}

function parseRevision(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Revision must be a positive integer.");
  }
  return parsed;
}

function parsePair(value: string, label: string): [number, number] {
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`${label} must contain two comma-separated numbers.`);
  }
  return [parts[0] ?? 0, parts[1] ?? 0];
}

function parseRectangle(value: string): [number, number, number, number] {
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("Rectangle must contain four comma-separated numbers.");
  }
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

function parseStatus(value: string): BrowserAnnotationStatus {
  const parsed = browserAnnotationStatusSchema.safeParse(value);
  if (!parsed.success)
    throw new Error("Status must be open, sent, or resolved.");
  return parsed.data;
}

function printAnnotation(annotation: BrowserAnnotation): void {
  console.log(
    `${annotation.id}\t${annotation.status}\tr${annotation.revision}\t${annotation.browserTabId}\t${annotation.comment}`,
  );
}

export function registerAnnotationCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const annotations = parent
    .command("annotations")
    .description("Manage browser annotations for a thread");

  annotations
    .command("list")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .option("--tab <id>", "Only annotations from this browser tab")
    .option("--status <status>", "Only open, sent, or resolved annotations")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: CommonOptions & { tab?: string; status?: string },
        ) => {
          const target = resolveTarget(id);
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.annotations.list({
            threadId: target.id,
            ...(opts.tab === undefined ? {} : { browserTabId: opts.tab }),
            ...(opts.status === undefined
              ? {}
              : { status: parseStatus(opts.status) }),
          });
          if (outputJson(opts, { threadId: target.id, ...result })) return;
          printContextLabel(target, "Thread", "BB_THREAD_ID", opts);
          if (result.annotations.length === 0) {
            console.log("No browser annotations.");
            return;
          }
          result.annotations.forEach(printAnnotation);
        },
      ),
    );

  annotations
    .command("add")
    .argument("<comment>", "Annotation comment")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .requiredOption("--tab <id>", "Browser tab ID")
    .requiredOption("--url <url>", "Page URL")
    .requiredOption("--selector <selector>", "Target CSS selector")
    .requiredOption("--viewport <width,height>", "Viewport size")
    .requiredOption("--rect <x,y,width,height>", "Target rectangle")
    .option("--environment <id>", "Environment ID")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          comment: string,
          id: string | undefined,
          opts: CommonOptions & {
            environment?: string;
            rect: string;
            selector: string;
            tab: string;
            url: string;
            viewport: string;
          },
        ) => {
          const target = resolveTarget(id);
          const [viewportWidth, viewportHeight] = parsePair(
            opts.viewport,
            "Viewport",
          );
          const [x, y, width, height] = parseRectangle(opts.rect);
          const annotation = await createCliBbSdk(
            getUrl(),
          ).threads.annotations.create({
            threadId: target.id,
            environmentId: opts.environment ?? null,
            browserTabId: opts.tab,
            url: opts.url,
            selector: opts.selector,
            viewport: { width: viewportWidth, height: viewportHeight },
            rectangle: { x, y, width, height },
            comment,
            status: "open",
          });
          if (outputJson(opts, annotation)) return;
          printAnnotation(annotation);
        },
      ),
    );

  annotations
    .command("update")
    .argument("<annotationId>", "Annotation ID")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .requiredOption("--revision <number>", "Expected revision", parseRevision)
    .option("--comment <text>", "Replace the comment")
    .option("--status <status>", "Set open, sent, or resolved")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          annotationId: string,
          id: string | undefined,
          opts: CommonOptions & {
            comment?: string;
            revision: number;
            status?: string;
          },
        ) => {
          if (opts.comment === undefined && opts.status === undefined) {
            throw new Error("Pass --comment or --status.");
          }
          const target = resolveTarget(id);
          const annotation = await createCliBbSdk(
            getUrl(),
          ).threads.annotations.update({
            annotationId,
            threadId: target.id,
            expectedRevision: opts.revision,
            ...(opts.comment === undefined ? {} : { comment: opts.comment }),
            ...(opts.status === undefined
              ? {}
              : { status: parseStatus(opts.status) }),
          });
          if (outputJson(opts, annotation)) return;
          printAnnotation(annotation);
        },
      ),
    );

  annotations
    .command("delete")
    .argument("<annotationId>", "Annotation ID")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .requiredOption("--revision <number>", "Expected revision", parseRevision)
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          annotationId: string,
          id: string | undefined,
          opts: CommonOptions & { revision: number },
        ) => {
          const target = resolveTarget(id);
          await createCliBbSdk(getUrl()).threads.annotations.delete({
            annotationId,
            expectedRevision: opts.revision,
            threadId: target.id,
          });
          if (outputJson(opts, { ok: true, annotationId, threadId: target.id }))
            return;
          console.log(`Deleted annotation ${annotationId}.`);
        },
      ),
    );

  annotations
    .command("clear")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .option("--tab <id>", "Only clear this browser tab")
    .option("--annotation <id...>", "Only clear these annotation IDs")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: CommonOptions & { annotation?: string[]; tab?: string },
        ) => {
          const target = resolveTarget(id);
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.annotations.clear({
            threadId: target.id,
            browserTabId: opts.tab ?? null,
            ids: opts.annotation ?? null,
          });
          if (outputJson(opts, { threadId: target.id, ...result })) return;
          console.log(`Deleted ${result.deleted} browser annotations.`);
        },
      ),
    );
}
