import { Suspense, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import type { SpaceResponse } from "@bb/server-contract";

/** Shared by the mount and the host's crash check. */
export const THREAD_LIST_SLOT_KIND = "threadList";

interface PluginThreadListProps {
  slot: PluginThreadListSlot;
  /**
   * The built-in list. Rendered instead of the plugin when its component
   * crashes: unlike an additive slot, there is no useful "plugin crashed"
   * chip to show here — a chip in place of the whole sidebar would strand the
   * user with no way to reach their threads.
   */
  builtInFallback: ReactNode;
  /** The host search field's text; "" when closed or plugin-owned. */
  searchQuery: string;
  onNavigate: () => void;
  activeSpaceId: string;
  moveProject: (projectId: string, spaceId: string) => void;
  moveProjects: (projectIds: readonly string[], spaceId: string) => void;
  spaces: readonly SpaceResponse[];
}

/**
 * Mounts the chosen `experimental_threadList` slot in the sidebar's scroll
 * area, keyed by generation so a plugin reload remounts it with fresh
 * error-boundary state.
 */
export function PluginThreadList({
  slot,
  builtInFallback,
  searchQuery,
  onNavigate,
  activeSpaceId,
  moveProject,
  moveProjects,
  spaces,
}: PluginThreadListProps) {
  const { projectId, threadId } = useRouteState();
  const { isCompactViewport } = useSidebar();
  const Component = slot.component;

  const handleCrash = useCallback(
    (pluginId: string) => {
      toast.error("Sidebar plugin crashed", {
        description: `${slot.title} (${pluginId}) stopped working, so bb's own thread list is back.`,
      });
    },
    [slot.title],
  );

  return (
    <PluginSlotMount
      key={`${slot.pluginId}/${slot.id}/${slot.generation}`}
      pluginId={slot.pluginId}
      slotKind={THREAD_LIST_SLOT_KIND}
      slotId={slot.id}
      crashFallback={builtInFallback}
      onCrash={handleCrash}
    >
      <Suspense fallback={builtInFallback}>
        <Component
          activeThreadId={threadId ?? null}
          activeProjectId={projectId ?? null}
          experimental_spaces={{
            activeSpaceId,
            spaces: spaces.map((space) => ({
              id: space.id,
              name: space.name,
              projectIds: space.projectIds,
            })),
            moveProject,
            moveProjects,
          }}
          isCompactViewport={isCompactViewport}
          onNavigate={onNavigate}
          searchQuery={searchQuery}
        />
      </Suspense>
    </PluginSlotMount>
  );
}
