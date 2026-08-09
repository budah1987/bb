import type { PluginPanelActionEntry } from "@/components/plugin/PluginPanelActions";
import {
  NewTabActions,
  NewTabFileSearch,
  type NewTabFileSearchProps,
  type OpenBrowserHandler,
  type OpenNotesHandler,
  type OpenSimulatorHandler,
  type StartTerminalHandler,
} from "./NewTabFileSearch";
import { useEnvironmentSimulatorStatus } from "@/hooks/queries/environment-queries";

type NewTabPageFileSearchProps = Omit<NewTabFileSearchProps, "idleActions">;

export interface NewTabPageProps extends NewTabPageFileSearchProps {
  onOpenBrowser?: OpenBrowserHandler;
  onOpenNotes?: OpenNotesHandler;
  onOpenSimulator?: OpenSimulatorHandler;
  simulatorRunning?: boolean;
  onStartTerminal?: StartTerminalHandler;
  pluginActions?: readonly PluginPanelActionEntry[];
}

function SimulatorActions({
  environmentId,
  onOpenBrowser,
  onOpenNotes,
  onOpenSimulator,
  onStartTerminal,
  pluginActions,
  simulatorRunning,
}: Pick<
  NewTabPageProps,
  | "environmentId"
  | "onOpenBrowser"
  | "onOpenNotes"
  | "onOpenSimulator"
  | "onStartTerminal"
  | "pluginActions"
  | "simulatorRunning"
>) {
  const simulatorStatus = useEnvironmentSimulatorStatus(environmentId);
  return (
    <NewTabActions
      onOpenBrowser={onOpenBrowser}
      onOpenNotes={onOpenNotes}
      onOpenSimulator={onOpenSimulator}
      onStartTerminal={onStartTerminal}
      pluginActions={pluginActions}
      simulatorRunning={
        simulatorRunning ?? simulatorStatus.data?.active != null
      }
    />
  );
}

/**
 * Browser-style "New Tab" landing page for the secondary panel. The tab body
 * keeps file search primary while secondary commands live in-page, avoiding
 * overlays that can be occluded by native browser/webview surfaces.
 */
export function NewTabPage({
  currentThreadId,
  environmentId,
  hostId,
  focusRequest,
  initialQuery,
  onOpenBrowser,
  onOpenNotes,
  onOpenSimulator,
  onSelect,
  onStartTerminal,
  pluginActions,
  simulatorRunning,
  projectId,
  recentItemsThreadId,
  showFileSearch,
}: NewTabPageProps) {
  return (
    <div className="flex min-h-full flex-col gap-3 bg-sidebar px-4 pb-3 pt-1">
      <NewTabFileSearch
        projectId={projectId}
        environmentId={environmentId}
        hostId={hostId}
        currentThreadId={currentThreadId}
        focusRequest={focusRequest}
        idleActions={
          onOpenSimulator ? (
            <SimulatorActions
              environmentId={environmentId}
              onOpenBrowser={onOpenBrowser}
              onOpenNotes={onOpenNotes}
              onOpenSimulator={onOpenSimulator}
              onStartTerminal={onStartTerminal}
              pluginActions={pluginActions}
              simulatorRunning={simulatorRunning}
            />
          ) : (
            <NewTabActions
              onOpenBrowser={onOpenBrowser}
              onOpenNotes={onOpenNotes}
              onStartTerminal={onStartTerminal}
              pluginActions={pluginActions}
            />
          )
        }
        initialQuery={initialQuery}
        onSelect={onSelect}
        recentItemsThreadId={recentItemsThreadId}
        showFileSearch={showFileSearch}
      />
    </div>
  );
}
