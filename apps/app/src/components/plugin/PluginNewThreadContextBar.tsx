import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadListProvider } from "@/components/sidebar/threadListProvider";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginNewThreadContextBar({
  projectId,
  environmentId,
  onCloseHandlerChange,
}: {
  projectId: string;
  environmentId: string | null;
  onCloseHandlerChange: (handler: (() => boolean) | null) => void;
}) {
  const provider = useThreadListProvider();
  const isCompactViewport = useIsCompactViewport();
  const Component = provider?.experimental_newThreadContextBar;

  if (provider === null || Component === undefined) return null;

  return (
    <PluginSlotMount
      key={`${provider.pluginId}/${provider.id}/${provider.generation}/new-thread/${environmentId ?? "unassigned"}`}
      pluginId={provider.pluginId}
      slotKind="newThreadContextBar"
      slotId={provider.id}
      instanceId={environmentId ?? `unassigned:${projectId}`}
      crashFallback={null}
    >
      <Component
        projectId={projectId}
        environmentId={environmentId}
        isCompactViewport={isCompactViewport}
        experimental_registerCloseHandler={onCloseHandlerChange}
      />
    </PluginSlotMount>
  );
}
