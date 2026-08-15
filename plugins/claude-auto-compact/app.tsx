import { useCallback, useEffect, useState } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { Slider } from "@bb/shared-ui/slider";
import { Switch } from "@bb/shared-ui/switch";
import type {
  claudeAutoCompactRpcContract,
  CompactSettings,
} from "./src/contract.js";
import { DEFAULT_WINDOW, MAX_WINDOW, MIN_WINDOW } from "./src/contract.js";

const REALTIME_CHANNEL = "settings-changed";

function ClaudeAutoCompactSettings() {
  const rpc = useRpc<typeof claudeAutoCompactRpcContract>();
  const [settings, setSettings] = useState<CompactSettings>({
    enabled: true,
    autoCompactWindow: DEFAULT_WINDOW,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await rpc.call("getSettings", null);
    setSettings(next);
    setError(null);
  }, [rpc]);

  const save = useCallback(
    async (next: CompactSettings) => {
      setSettings(next);
      setSaving(true);
      setError(null);
      try {
        setSettings(await rpc.call("updateSettings", next));
      } catch {
        setError("Could not save this setting.");
        await load().catch(() => undefined);
      } finally {
        setSaving(false);
      }
    },
    [load, rpc],
  );

  useEffect(() => {
    let active = true;
    void load()
      .catch(() => {
        if (active) setError("Could not load this setting.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  useRealtime(
    REALTIME_CHANNEL,
    useCallback(() => void load().catch(() => undefined), [load]),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">
            Automatic compaction
          </div>
          <p className="text-sm text-muted-foreground">
            Claude Code compacts long sessions silently before later turns
            become expensive.
          </p>
        </div>
        <Switch
          aria-label="Automatic compaction"
          checked={settings.enabled}
          disabled={loading || saving}
          onCheckedChange={(enabled) => void save({ ...settings, enabled })}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-medium text-foreground">Compact near</span>
          <span className="tabular-nums text-muted-foreground">
            {settings.autoCompactWindow / 1_000}k context tokens
          </span>
        </div>
        <Slider
          aria-label="Compaction threshold"
          min={MIN_WINDOW}
          max={MAX_WINDOW}
          step={10_000}
          value={[settings.autoCompactWindow]}
          disabled={loading || saving || !settings.enabled}
          onValueChange={([autoCompactWindow]) => {
            if (autoCompactWindow !== undefined) {
              setSettings((current) => ({ ...current, autoCompactWindow }));
            }
          }}
          onValueCommit={([autoCompactWindow]) => {
            if (autoCompactWindow !== undefined) {
              void save({ ...settings, autoCompactWindow });
            }
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>250k</span>
          <span>400k</span>
        </div>
      </div>

      <div className="min-h-4 text-xs text-muted-foreground" role="status">
        {error ??
          (saving
            ? "Saving…"
            : "Changes apply to the next Claude Code session.")}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "claude-auto-compact",
    description: "Control Claude Code's native automatic context compaction.",
    component: ClaudeAutoCompactSettings,
  });
});
