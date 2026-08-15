import type {
  BbPluginApi,
  PluginCliContext,
  PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { IngestionStore } from "./store.js";
import type { IngestionSourceInput } from "./contract.js";

const HELP = `Usage: bb ingestion <command> [options]

Commands:
  ingest [--project <id>] (--content <text> | --url <url>) [--context <text>] [--json]
  status [--project <id>] [--json]                 List ingestion cases
  create --project <id> --title <title> --kind <kind> --label <label> (--content <text> | --url <url>) [--json]
  source add <case-id> --kind <kind> --label <label> (--content <text> | --url <url>) [--json]
  show <case-id> [--json]
  draft <case-id> [--json]
  submit-draft <case-id> --markdown <text> [--output <path:summary>]... [--json]
  publish <case-id> [--preserve-local-changes] [--json]`;

class UsageError extends Error {}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--"))
    throw new UsageError(`--${name} requires a value`);
  return value;
}

function values(argv: string[], name: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== `--${name}`) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new UsageError(`--${name} requires a value`);
    result.push(value);
    index += 1;
  }
  return result;
}

function required(argv: string[], name: string): string {
  const value = option(argv, name);
  if (value === undefined) throw new UsageError(`--${name} is required`);
  return value;
}

function sourceFromArgs(argv: string[]): IngestionSourceInput {
  const content = option(argv, "content") ?? null;
  const url = option(argv, "url") ?? null;
  if ((content === null) === (url === null)) {
    throw new UsageError("Provide exactly one of --content or --url");
  }
  const authority = option(argv, "authority") ?? "context";
  if (!["primary", "context", "evidence"].includes(authority))
    throw new UsageError("--authority must be primary, context, or evidence");
  const kind = required(argv, "kind");
  if (
    !["upload", "pasted", "drive_link", "granola_paste", "url"].includes(kind)
  ) {
    throw new UsageError(
      "--kind must be upload, pasted, drive_link, granola_paste, or url",
    );
  }
  return {
    kind: kind as IngestionSourceInput["kind"],
    label: required(argv, "label"),
    authority: authority as IngestionSourceInput["authority"],
    url,
    content,
  };
}

function output(argv: string[]): string[] {
  return values(argv, "output");
}

function outputItems(argv: string[]) {
  return output(argv).map((value) => {
    const separator = value.indexOf(":");
    if (separator < 1 || separator === value.length - 1)
      throw new UsageError("--output must use path:summary");
    return {
      path: value.slice(0, separator),
      summary: value.slice(separator + 1),
    };
  });
}

function render(value: unknown, json: boolean): string {
  if (json) return JSON.stringify(value, null, 2);
  if (Array.isArray(value))
    return value
      .map((item) => {
        const caseItem = item as { id: string; status: string; title: string };
        return `${caseItem.id}  ${caseItem.status}  ${caseItem.title}`;
      })
      .join("\n");
  const caseItem = value as {
    id: string;
    status: string;
    title: string;
    sources?: unknown[];
  };
  return `${caseItem.id}\n${caseItem.status}\n${caseItem.title}\n${caseItem.sources?.length ?? 0} sources`;
}

export function registerIngestionCli(args: {
  bb: BbPluginApi;
  store: IngestionStore;
  startDraft: (caseId: string, context: PluginCliContext) => Promise<unknown>;
  ingestMeeting: (input: {
    projectId: string | null;
    context: string;
    sources: IngestionSourceInput[];
  }) => Promise<unknown>;
  submitDraft: (
    caseId: string,
    markdown: string,
    outputs: ReturnType<typeof outputItems>,
  ) => unknown;
  publish: (caseId: string, preserveLocalChanges: boolean) => Promise<unknown>;
}): void {
  args.bb.cli.register({
    name: "ingestion",
    summary: "Review and publish meeting and document ingestions",
    commands: [
      {
        name: "ingest",
        summary: "Ingest meeting material for review",
        usage:
          "bb ingestion ingest [--project <id>] (--content <text> | --url <url>) [--context <text>] [--json]",
      },
      {
        name: "status",
        summary: "List cases",
        usage: "bb ingestion status [--project <id>] [--json]",
      },
      {
        name: "create",
        summary: "Create a case",
        usage:
          "bb ingestion create --project <id> --title <title> --kind <kind> --label <label> (--content <text> | --url <url>)",
      },
      {
        name: "show",
        summary: "Show a case",
        usage: "bb ingestion show <case-id> [--json]",
      },
      {
        name: "draft",
        summary: "Start drafting",
        usage: "bb ingestion draft <case-id> [--json]",
      },
      {
        name: "publish",
        summary: "Publish a ready case",
        usage:
          "bb ingestion publish <case-id> [--preserve-local-changes] [--json]",
      },
    ],
    async run(argv, context): Promise<PluginCliResult> {
      const json = argv.includes("--json");
      try {
        const command = argv[0];
        if (
          command === undefined ||
          command === "help" ||
          command === "--help" ||
          command === "-h"
        )
          return { exitCode: 0, stdout: HELP };
        let result: unknown;
        if (command === "ingest") {
          const content = option(argv, "content") ?? null;
          const url = option(argv, "url") ?? null;
          if ((content === null) === (url === null))
            throw new UsageError("Provide exactly one of --content or --url");
          const isDrive =
            url !== null &&
            /^https:\/\/(?:drive|docs)\.google\.com\//i.test(url);
          result = await args.ingestMeeting({
            projectId: option(argv, "project") ?? context.projectId ?? null,
            context: option(argv, "context") ?? "",
            sources: [
              {
                kind: url === null ? "granola_paste" : isDrive ? "drive_link" : "url",
                label: url === null ? "Pasted meeting material" : isDrive ? "Google Drive document" : "Meeting context link",
                authority: url === null || isDrive ? "primary" : "context",
                url,
                content,
              },
            ],
          });
        } else if (command === "status")
          result = args.store.listSummaries(option(argv, "project") ?? null);
        else if (command === "create")
          result = args.store.create({
            projectId: required(argv, "project"),
            title: required(argv, "title"),
            source: sourceFromArgs(argv),
          });
        else if (command === "show")
          result = args.store.get(
            argv[1] ??
              (() => {
                throw new UsageError("show requires a case ID");
              })(),
          );
        else if (command === "source" && argv[1] === "add")
          result = args.store.appendSource(
            argv[2] ??
              (() => {
                throw new UsageError("source add requires a case ID");
              })(),
            sourceFromArgs(argv),
          );
        else if (command === "draft")
          result = await args.startDraft(
            argv[1] ??
              (() => {
                throw new UsageError("draft requires a case ID");
              })(),
            context,
          );
        else if (command === "submit-draft")
          result = args.submitDraft(
            argv[1] ??
              (() => {
                throw new UsageError("submit-draft requires a case ID");
              })(),
            required(argv, "markdown"),
            outputItems(argv),
          );
        else if (command === "publish")
          result = await args.publish(
            argv[1] ??
              (() => {
                throw new UsageError("publish requires a case ID");
              })(),
            argv.includes("--preserve-local-changes"),
          );
        else throw new UsageError(`Unknown command: ${command}`);
        return { exitCode: 0, stdout: render(result, json) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json
          ? {
              exitCode: error instanceof UsageError ? 2 : 1,
              stdout: JSON.stringify({ error: message }),
            }
          : { exitCode: error instanceof UsageError ? 2 : 1, stderr: message };
      }
    },
  });
}
