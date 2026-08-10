import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import type { SimulatorControlAction } from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface SimulatorOptions {
  environment?: string;
  json?: boolean;
}

function environmentId(opts: SimulatorOptions): string {
  const value =
    opts.environment?.trim() || process.env.BB_ENVIRONMENT_ID?.trim();
  if (!value) {
    throw new Error(
      "Missing environment ID. Run from a BB thread or pass --environment <id>.",
    );
  }
  return value;
}

function coordinate(value: string, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${label} must be a normalized number from 0 to 1.`);
  }
  return number;
}

function simulatorButton(
  value: string,
): Extract<SimulatorControlAction, { kind: "button" }>["button"] {
  switch (value) {
    case "home":
    case "swipe_home":
    case "app_switcher":
    case "lock":
    case "siri":
    case "side_button":
      return value;
    default:
      throw new Error(
        "button must be home, swipe_home, app_switcher, lock, siri, or side_button.",
      );
  }
}

function simulatorOrientation(
  value: string,
): Extract<SimulatorControlAction, { kind: "rotate" }>["orientation"] {
  switch (value) {
    case "portrait":
    case "portrait_upside_down":
    case "landscape_left":
    case "landscape_right":
      return value;
    default:
      throw new Error(
        "orientation must be portrait, portrait_upside_down, landscape_left, or landscape_right.",
      );
  }
}

function addCommonOptions(command: Command): Command {
  return command
    .option(
      "--environment <id>",
      "Environment ID (defaults to BB_ENVIRONMENT_ID)",
    )
    .option("--json", "Print machine-readable JSON output");
}

export function registerSimulatorCommands(
  program: Command,
  getUrl: () => string,
): void {
  const simulator = program
    .command("simulator")
    .description("Inspect and control an environment's iOS Simulator");

  addCommonOptions(
    simulator
      .command("list")
      .alias("status")
      .description("List devices and the active session"),
  ).action(
    action(async (opts: SimulatorOptions) => {
      const result = await createCliBbSdk(
        getUrl(),
      ).environments.simulatorStatus({
        environmentId: environmentId(opts),
      });
      if (outputJson(opts, result)) return;
      if (!result.supported) {
        console.log(result.message ?? "iOS Simulator is unavailable.");
        return;
      }
      for (const device of result.devices) {
        const active = result.active?.deviceUdid === device.udid ? " *" : "";
        console.log(
          `${device.udid}\t${device.name}\t${device.runtime}\t${device.state}${active}`,
        );
      }
    }),
  );

  addCommonOptions(
    simulator
      .command("attach [deviceUdid]")
      .description("Boot and attach to a simulator device"),
  ).action(
    action(async (deviceUdid: string | undefined, opts: SimulatorOptions) => {
      const result = await createCliBbSdk(
        getUrl(),
      ).environments.simulatorAttach({
        environmentId: environmentId(opts),
        ...(deviceUdid === undefined ? {} : { deviceUdid }),
      });
      if (outputJson(opts, result)) return;
      console.log(
        `Attached ${result.session.deviceName} (${result.session.deviceUdid})`,
      );
    }),
  );

  const control = (
    command: Command,
    buildAction: (...values: string[]) => SimulatorControlAction,
  ) =>
    addCommonOptions(command).action(
      action(async (...args: unknown[]) => {
        const opts = args.at(-1) as SimulatorOptions;
        const values = args.slice(0, -1) as string[];
        const result = await createCliBbSdk(
          getUrl(),
        ).environments.simulatorControl({
          environmentId: environmentId(opts),
          action: buildAction(...values),
        });
        if (!outputJson(opts, result)) console.log("OK");
      }),
    );

  control(
    simulator
      .command("tap <x> <y>")
      .description("Tap normalized screen coordinates"),
    (x, y) => ({ kind: "tap", x: coordinate(x, "x"), y: coordinate(y, "y") }),
  );
  control(
    simulator
      .command("swipe <startX> <startY> <endX> <endY>")
      .description("Swipe between normalized screen coordinates"),
    (startX, startY, endX, endY) => ({
      kind: "gesture",
      points: [
        {
          type: "begin",
          x: coordinate(startX, "startX"),
          y: coordinate(startY, "startY"),
        },
        {
          type: "end",
          x: coordinate(endX, "endX"),
          y: coordinate(endY, "endY"),
        },
      ],
    }),
  );
  control(
    simulator.command("type <text>").description("Type text"),
    (text) => ({
      kind: "type",
      text,
    }),
  );
  control(
    simulator
      .command("button <name>")
      .description("Press home, lock, Siri, side, or app switcher"),
    (button) => ({
      kind: "button",
      button: simulatorButton(button),
    }),
  );
  control(
    simulator
      .command("rotate <orientation>")
      .description("Rotate the simulator"),
    (orientation) => ({
      kind: "rotate",
      orientation: simulatorOrientation(orientation),
    }),
  );

  addCommonOptions(
    simulator.command("ax").description("Print the accessibility tree"),
  ).action(
    action(async (opts: SimulatorOptions) => {
      const result = await createCliBbSdk(
        getUrl(),
      ).environments.simulatorAccessibility({
        environmentId: environmentId(opts),
      });
      console.log(JSON.stringify(result.tree, null, 2));
    }),
  );

  addCommonOptions(
    simulator
      .command("screenshot")
      .description("Capture a PNG screenshot")
      .requiredOption("--out <path>", "Output PNG path"),
  ).action(
    action(async (opts: SimulatorOptions & { out: string }) => {
      const result = await createCliBbSdk(
        getUrl(),
      ).environments.simulatorScreenshot({
        environmentId: environmentId(opts),
      });
      await writeFile(opts.out, Buffer.from(result.dataBase64, "base64"));
      if (!outputJson(opts, { path: opts.out, mimeType: result.mimeType })) {
        console.log(`Saved ${opts.out}`);
      }
    }),
  );

  addCommonOptions(
    simulator.command("stop").description("Stop the managed simulator session"),
  ).action(
    action(async (opts: SimulatorOptions) => {
      const result = await createCliBbSdk(getUrl()).environments.simulatorStop({
        environmentId: environmentId(opts),
      });
      if (!outputJson(opts, result))
        console.log(
          result.stopped ? "Stopped simulator" : "No simulator was running",
        );
    }),
  );
}
