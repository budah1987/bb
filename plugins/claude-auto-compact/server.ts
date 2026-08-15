import type { BbPluginApi, PluginCliResult } from "@get-bb/plugin-sdk";
import {
  claudeAutoCompactRpcContract,
  compactSettingsSchema,
  DEFAULT_WINDOW,
  MAX_WINDOW,
  MIN_WINDOW,
  type CompactSettings,
} from "./src/contract.js";

const SETTINGS_KEY = "settings";
const REALTIME_CHANNEL = "settings-changed";
const DEFAULT_SETTINGS: CompactSettings = {
  enabled: true,
  autoCompactWindow: DEFAULT_WINDOW,
};

function parseThreshold(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = /^(\d+)(k)?$/i.exec(value.trim());
  if (match === null) return null;
  const amount = Number(match[1]);
  const tokens =
    match[2] === undefined && amount >= MIN_WINDOW ? amount : amount * 1_000;
  return Number.isInteger(tokens) &&
    tokens >= MIN_WINDOW &&
    tokens <= MAX_WINDOW
    ? tokens
    : null;
}

export default async function plugin(bb: BbPluginApi) {
  const stored = compactSettingsSchema.safeParse(
    await bb.storage.kv.get(SETTINGS_KEY),
  );
  let settings: CompactSettings = stored.success
    ? stored.data
    : DEFAULT_SETTINGS;

  async function update(next: CompactSettings): Promise<CompactSettings> {
    settings = compactSettingsSchema.parse(next);
    await bb.storage.kv.set(SETTINGS_KEY, settings);
    bb.realtime.publish(REALTIME_CHANNEL, settings);
    return settings;
  }

  bb.agents.experimental_configureClaudeCodeSession((context) =>
    context.provider.id === "claude-code"
      ? {
          autoCompactEnabled: settings.enabled,
          autoCompactWindow: settings.autoCompactWindow,
        }
      : null,
  );

  bb.rpc.register(claudeAutoCompactRpcContract, {
    getSettings() {
      return settings;
    },
    updateSettings(input) {
      return update(input);
    },
  });

  bb.cli.register({
    name: "claude-compact",
    summary: "Configure Claude Code automatic context compaction",
    commands: [
      {
        name: "status",
        summary: "Show the current policy",
        usage: "bb claude-compact status [--json]",
      },
      {
        name: "on",
        summary: "Enable automatic compaction",
        usage: "bb claude-compact on",
      },
      {
        name: "off",
        summary: "Disable automatic compaction",
        usage: "bb claude-compact off",
      },
      {
        name: "threshold",
        summary: "Set the compaction threshold",
        usage: "bb claude-compact threshold <250k-400k>",
      },
    ],
    async run(argv): Promise<PluginCliResult> {
      const [command, value] = argv;
      if (command === "on" || command === "off") {
        const next = await update({ ...settings, enabled: command === "on" });
        return {
          exitCode: 0,
          stdout: `${next.enabled ? "Enabled" : "Disabled"} Claude automatic compaction.\n`,
        };
      }
      if (command === "threshold") {
        const tokens = parseThreshold(value);
        if (tokens === null) {
          return {
            exitCode: 2,
            stderr: "Threshold must be from 250k to 400k tokens.\n",
          };
        }
        await update({ ...settings, autoCompactWindow: tokens });
        return {
          exitCode: 0,
          stdout: `Claude automatic compaction threshold: ${tokens / 1_000}k tokens.\n`,
        };
      }
      if (command === "status") {
        return argv.includes("--json")
          ? { exitCode: 0, stdout: `${JSON.stringify(settings, null, 2)}\n` }
          : {
              exitCode: 0,
              stdout: `Claude automatic compaction is ${settings.enabled ? "on" : "off"} at ${settings.autoCompactWindow / 1_000}k tokens.\n`,
            };
      }
      return {
        exitCode: 2,
        stderr: "Usage: bb claude-compact <status|on|off|threshold>\n",
      };
    },
  });
}
