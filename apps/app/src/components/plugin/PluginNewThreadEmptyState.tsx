import { Suspense } from "react";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { useThreadListProvider } from "@/components/sidebar/threadListProvider";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginNewThreadEmptyState({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string | null;
}) {
  const provider = useThreadListProvider();
  const isCompactViewport = useIsCompactViewport();
  const Component = provider?.experimental_newThreadEmptyState;

  if (provider === null || Component === undefined) return null;

  return (
    <PluginSlotMount
      key={`${provider.pluginId}/${provider.id}/${provider.generation}/new-thread-empty-state/${environmentId ?? "unassigned"}`}
      pluginId={provider.pluginId}
      slotKind="newThreadEmptyState"
      slotId={provider.id}
      instanceId={environmentId ?? `unassigned:${projectId}`}
      crashFallback={null}
    >
      <Suspense fallback={null}>
        <Component
          projectId={projectId}
          environmentId={environmentId}
          isCompactViewport={isCompactViewport}
        />
      </Suspense>
    </PluginSlotMount>
  );
}
