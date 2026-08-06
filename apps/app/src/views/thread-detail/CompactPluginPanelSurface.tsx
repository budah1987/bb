import { AppPageHeader } from "@/components/layout/AppPageHeader";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import { usePluginSlots } from "@/lib/plugin-slots";
import type { PaneContent } from "@/lib/split-layout";
import { PluginPanelView } from "@/views/PluginPanelView";

/**
 * A plugin panel page whose own header travels with it.
 *
 * Everywhere else the compact plugin header lives in the shared AppLayout
 * chrome. Inside the standalone-compact workspace that chrome would stay put
 * while the body slides, leaving a title above the wrong page, so this surface
 * takes ownership of exactly the header AppLayout would have drawn (see
 * AppHeader's plugin branch) and AppLayout stands down for the same condition.
 */
export function CompactPluginPanelSurface({
  content,
}: {
  content: Extract<PaneContent, { kind: "plugin-panel" }>;
}) {
  const { navPanels } = usePluginSlots();
  const panel = navPanels.find(
    (candidate) =>
      candidate.pluginId === content.pluginId &&
      candidate.path === content.panelPath,
  );

  return (
    // The panel body owns its own padding, so cancel the page padding here and
    // re-apply it below the header — the same geometry the page had when the
    // shared header sat above this box.
    <div
      data-compact-plugin-panel-surface=""
      className="-m-4 flex min-h-0 min-w-0 flex-1 flex-col md:-m-5"
    >
      <AppPageHeader
        center={panel ? <PluginPanelHeaderCenter panel={panel} /> : null}
        actions={
          panel ? (
            <PluginPanelHeaderActions panel={panel} subPath={content.subPath} />
          ) : null
        }
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-5">
        <PluginPanelView
          pluginId={content.pluginId}
          panelPath={content.panelPath}
          subPath={content.subPath}
        />
      </div>
    </div>
  );
}
