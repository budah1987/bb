import { useThread } from "@/hooks/queries/thread-queries";
import { usePluginSlots } from "@/lib/plugin-slots";
import { PluginSlotMount } from "./PluginSlotMount";

/** Plugin sections shown after BB's core environment rows in the right rail. */
export function PluginThreadRailSections({ threadId }: { threadId: string }) {
  const { threadRailSections } = usePluginSlots();
  const threadQuery = useThread(threadId, {
    enabled: threadRailSections.length > 0,
  });
  const thread = threadQuery.data;

  if (threadRailSections.length === 0 || thread === undefined) return null;

  return (
    <>
      {threadRailSections.map((slot) => {
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
            pluginId={slot.pluginId}
            slotKind="threadRailSection"
            slotId={slot.id}
            instanceId={threadId}
            crashFallback={<></>}
          >
            <section aria-label={slot.title}>
              <Component
                threadId={threadId}
                projectId={thread.projectId}
                environmentId={thread.environmentId}
              />
            </section>
          </PluginSlotMount>
        );
      })}
    </>
  );
}
