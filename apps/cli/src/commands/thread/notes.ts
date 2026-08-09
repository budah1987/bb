import { Command } from "commander";
import {
  THREAD_SCRATCHPAD_MAX_LENGTH,
  type ThreadNotesResponse,
} from "@bb/server-contract";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../../context-env.js";
import { outputJson, printContextLabel, type ResolvedId } from "../helpers.js";

interface ThreadNotesCommandOptions {
  json?: boolean;
}

interface ThreadNotesRecapOptions extends ThreadNotesCommandOptions {
  force?: boolean;
}

function resolveThreadNotesTarget(id: string | undefined): ResolvedId {
  const explicit = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: id,
  });
  if (explicit !== undefined) {
    return { id: explicit, source: "arg" };
  }
  const context = resolveContextThreadId();
  if (context !== undefined) {
    return { id: context, source: "env" };
  }
  throw new Error(
    "Missing thread ID. Pass <threadId> or run inside a BB thread.",
  );
}

function printNotes(notes: ThreadNotesResponse): void {
  console.log(
    `Scratchpad: ${notes.scratchpad === "" ? "(empty)" : notes.scratchpad}`,
  );
  if (notes.recapBody === null) {
    console.log("Recap: (none)");
    return;
  }
  console.log(`Recap: ${notes.recapBody}`);
  if (notes.recapSourceSeq !== null) {
    console.log(`Recap source sequence: ${notes.recapSourceSeq}`);
  }
}

export function registerNotesCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const notes = parent
    .command("notes")
    .description("Read and write a thread's scratchpad and recap");

  notes
    .command("show")
    .description("Print a thread's scratchpad and recap")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadNotesCommandOptions) => {
          const target = resolveThreadNotesTarget(id);
          const result = await createCliBbSdk(getUrl()).threads.notes.get({
            threadId: target.id,
          });
          if (outputJson(opts, { threadId: target.id, ...result })) {
            return;
          }
          printContextLabel(target, "Thread", "BB_THREAD_ID", opts);
          console.log(`Thread: ${target.id}`);
          printNotes(result);
        },
      ),
    );

  notes
    .command("set")
    .description(
      `Replace a thread's scratchpad (max ${THREAD_SCRATCHPAD_MAX_LENGTH} characters)`,
    )
    .usage("<text> [id] [options]")
    .argument("<text>", "Scratchpad text. Pass an empty string to clear it.")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          text: string,
          id: string | undefined,
          opts: ThreadNotesCommandOptions,
        ) => {
          // Fail before the round trip so an over-long paste reports the limit
          // rather than a generic 400 from the server's own validation.
          if (text.length > THREAD_SCRATCHPAD_MAX_LENGTH) {
            throw new Error(
              `Scratchpad is ${text.length} characters; the maximum is ${THREAD_SCRATCHPAD_MAX_LENGTH}.`,
            );
          }
          const target = resolveThreadNotesTarget(id);
          const result = await createCliBbSdk(
            getUrl(),
          ).threads.notes.setScratchpad({
            scratchpad: text,
            threadId: target.id,
          });
          if (outputJson(opts, { threadId: target.id, ...result })) {
            return;
          }
          printContextLabel(target, "Thread", "BB_THREAD_ID", opts);
          console.log(`Thread: ${target.id}`);
          printNotes(result);
        },
      ),
    );

  notes
    .command("recap")
    .description("Generate a thread's recap from its conversation and state")
    .argument("[id]", "Thread ID. Omit inside a BB thread.")
    .option(
      "--force",
      "Regenerate even when the stored recap is already up to date",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadNotesRecapOptions) => {
        const target = resolveThreadNotesTarget(id);
        const result = await createCliBbSdk(
          getUrl(),
        ).threads.notes.generateRecap({
          force: opts.force ?? false,
          threadId: target.id,
        });
        if (outputJson(opts, { threadId: target.id, ...result })) {
          return;
        }
        printContextLabel(target, "Thread", "BB_THREAD_ID", opts);
        console.log(`Thread: ${target.id}`);
        printNotes(result);
      }),
    );
}
