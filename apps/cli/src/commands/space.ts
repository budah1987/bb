import { Command } from "commander";
import { spaceColorSchema, spaceIconSchema } from "@bb/domain";
import type { SpaceResponse } from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";

interface SpaceListOptions {
  json?: boolean;
}

interface SpaceWriteOptions {
  color: string;
  icon: string;
  json?: boolean;
  name: string;
}

interface SpaceDeleteOptions {
  json?: boolean;
  moveProjectsTo?: string;
  yes?: boolean;
}

interface SpaceMoveProjectOptions {
  json?: boolean;
}

function printSpaces(spaces: readonly SpaceResponse[]): void {
  const rows = spaces.map((space) => [
    space.id,
    space.name,
    space.icon,
    space.color,
    String(space.projectIds.length),
  ]);
  const widths = [0, 1, 2, 3, 4].map((column) =>
    Math.max(
      ["ID", "Name", "Icon", "Color", "Projects"][column]?.length ?? 0,
      ...rows.map((row) => row[column]?.length ?? 0),
    ),
  );
  console.log("");
  console.log(
    renderBorderlessTable(
      {
        head: ["ID", "Name", "Icon", "Color", "Projects"],
        colWidths: widths,
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
  console.log("");
}

function parseSpaceWriteOptions(options: SpaceWriteOptions) {
  return {
    name: options.name,
    icon: spaceIconSchema.parse(options.icon),
    color: spaceColorSchema.parse(options.color),
  };
}

export function registerSpaceCommands(
  program: Command,
  getUrl: () => string,
): void {
  const space = program.command("space").description("Manage Spaces");

  space
    .command("list")
    .description("List Spaces")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: SpaceListOptions) => {
        const spaces = await createCliBbSdk(getUrl()).spaces.list();
        if (outputJson(options, spaces)) return;
        printSpaces(spaces);
      }),
    );

  space
    .command("create")
    .description("Create a Space")
    .requiredOption("--name <name>", "Space name")
    .requiredOption("--icon <icon>", "Space icon")
    .requiredOption("--color <color>", "Sidebar color")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (options: SpaceWriteOptions) => {
        const created = await createCliBbSdk(getUrl()).spaces.create(
          parseSpaceWriteOptions(options),
        );
        if (outputJson(options, created)) return;
        console.log(`Space ${created.id} created`);
      }),
    );

  space
    .command("edit <id>")
    .description("Edit a Space")
    .requiredOption("--name <name>", "Space name")
    .requiredOption("--icon <icon>", "Space icon")
    .requiredOption("--color <color>", "Sidebar color")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, options: SpaceWriteOptions) => {
        const updated = await createCliBbSdk(getUrl()).spaces.update({
          spaceId: id,
          ...parseSpaceWriteOptions(options),
        });
        if (outputJson(options, updated)) return;
        console.log(`Space ${updated.id} updated`);
      }),
    );

  space
    .command("move-project <space-id> <project-id>")
    .description("Move a project to a Space")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          spaceId: string,
          projectId: string,
          options: SpaceMoveProjectOptions,
        ) => {
          const destination = await createCliBbSdk(getUrl()).spaces.moveProject(
            { projectId, spaceId },
          );
          if (outputJson(options, destination)) return;
          console.log(`Project ${projectId} moved to Space ${destination.id}`);
        },
      ),
    );

  space
    .command("delete <id>")
    .description("Delete a Space")
    .option(
      "--move-projects-to <id>",
      "Move contained projects to another Space",
    )
    .option("--yes", "Skip confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, options: SpaceDeleteOptions) => {
        if (!options.yes) {
          const confirmed = await confirmDestructiveAction(
            `Delete Space ${id}?`,
          );
          if (!confirmed) {
            console.log("Aborted.");
            return;
          }
        }
        const result = await createCliBbSdk(getUrl()).spaces.delete({
          spaceId: id,
          destinationSpaceId: options.moveProjectsTo ?? null,
        });
        if (outputJson(options, result)) return;
        console.log(`Space ${id} deleted`);
      }),
    );
}
