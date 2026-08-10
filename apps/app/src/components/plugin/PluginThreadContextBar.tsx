import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadListProvider } from "@/components/sidebar/threadListProvider";
import { PluginSlotMount } from "./PluginSlotMount";

/** Whether the selected sidebar provider supplies a thread context bar. */
export function useHasPluginThreadContextBar(): boolean {
  const provider = useThreadListProvider();
  return provider?.experimental_contextBar !== undefined;
}

/**
 * The selected sidebar provider's pane companion. Selection is client-local,
 * so this surface follows the same provider resolution and fallback as the
 * sidebar itself instead of being registered globally like a header action.
 */
export function PluginThreadContextBar({
  threadId,
  projectId,
  environmentId,
  onCloseHandlerChange,
}: {
  threadId: string;
  projectId: string;
  environmentId: string | null;
  onCloseHandlerChange: (handler: (() => boolean) | null) => void;
}) {
  const provider = useThreadListProvider();
  const isCompactViewport = useIsCompactViewport();
  const Component = provider?.experimental_contextBar;

  if (provider === null || Component === undefined) return null;

  return (
    <PluginSlotMount
      key={`${provider.pluginId}/${provider.id}/${provider.generation}/${threadId}`}
      pluginId={provider.pluginId}
      slotKind="threadContextBar"
      slotId={provider.id}
      instanceId={threadId}
      crashFallback={null}
    >
      <Component
        threadId={threadId}
        projectId={projectId}
        environmentId={environmentId}
        isCompactViewport={isCompactViewport}
        experimental_registerCloseHandler={onCloseHandlerChange}
      />
    </PluginSlotMount>
  );
}
