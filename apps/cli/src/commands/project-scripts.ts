import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { projectScriptInputSchema } from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface ScriptOptions {
  name: string;
  command: string;
  shortcut?: string;
  json?: boolean;
}

export function registerProjectScriptCommands(
  project: Command,
  getUrl: () => string,
): void {
  const script = project
    .command("script")
    .description("Manage saved project commands");
  const api = () => createCliBbSdk(getUrl()).projects.experimental_scripts;
  script
    .command("list <projectId>")
    .option("--json", "Print JSON")
    .action(
      action(async (projectId: string, options: { json?: boolean }) => {
        const result = await api().list({ projectId });
        if (outputJson(options, result)) return;
        for (const item of result.scripts)
          console.log(`${item.id}  ${item.name}  ${item.command}`);
        if (result.scripts.length === 0) console.log("No project scripts");
      }),
    );
  const input = (options: ScriptOptions) =>
    projectScriptInputSchema.parse({
      name: options.name,
      command: options.command,
      shortcut:
        options.shortcut === undefined ? null : Number(options.shortcut),
    });
  const saveOptions = (command: Command) =>
    command
      .requiredOption("--name <name>", "Script name")
      .requiredOption("--command <command>", "Shell command")
      .option("--shortcut <1-9>", "Shortcut slot (omit to leave unassigned)")
      .option("--json", "Print JSON");
  saveOptions(script.command("add <projectId>")).action(
    action(async (projectId: string, options: ScriptOptions) => {
      const result = await api().create({ projectId, ...input(options) });
      if (!outputJson(options, result))
        console.log(`Saved ${result.name}: ${result.id}`);
    }),
  );
  saveOptions(script.command("update <projectId> <scriptId>")).action(
    action(
      async (projectId: string, scriptId: string, options: ScriptOptions) => {
        const result = await api().update({
          projectId,
          scriptId,
          ...input(options),
        });
        if (!outputJson(options, result))
          console.log(`Saved ${result.name}: ${result.id}`);
      },
    ),
  );
  script
    .command("delete <projectId> <scriptId>")
    .option("--json", "Print JSON")
    .action(
      action(
        async (
          projectId: string,
          scriptId: string,
          options: { json?: boolean },
        ) => {
          const result = await api().delete({ projectId, scriptId });
          if (!outputJson(options, result))
            console.log("Project script deleted");
        },
      ),
    );
  script
    .command("import <projectId>")
    .requiredOption(
      "--client-file <path>",
      "t3.json on this CLI machine; import names and commands only",
    )
    .option("--json", "Print JSON")
    .action(
      action(
        async (
          projectId: string,
          options: { clientFile: string; json?: boolean },
        ) => {
          const result = await api().importT3({
            projectId,
            content: await readFile(options.clientFile, "utf8"),
          });
          if (!outputJson(options, result))
            console.log(`Imported ${result.scripts.length} project scripts`);
        },
      ),
    );
  script
    .command("run <projectId> <scriptId>")
    .requiredOption("--thread <id>", "Thread whose workspace runs the command")
    .option("--json", "Print JSON")
    .action(
      action(
        async (
          projectId: string,
          scriptId: string,
          options: { thread: string; json?: boolean },
        ) => {
          const session = await api().run({
            projectId,
            scriptId,
            threadId: options.thread,
          });
          if (!outputJson(options, session))
            console.log(`Started ${session.title}: ${session.id}`);
        },
      ),
    );
}
