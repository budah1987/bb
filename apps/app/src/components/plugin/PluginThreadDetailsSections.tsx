import { PluginSlotMount } from "./PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";

export function PluginThreadDetailsSections({
  threadId,
  projectId,
  environmentId,
  closeDetails,
}: {
  threadId: string;
  projectId: string;
  environmentId: string | null;
  closeDetails: () => void;
}) {
  const { threadDetailsSections } = usePluginSlots();

  if (threadDetailsSections.length === 0) return null;

  return (
    <>
      {threadDetailsSections.map((slot) => {
        const Component = slot.component;
        return (
          <PluginSlotMount
            key={`${slot.pluginId}/${slot.id}/${slot.generation}/${threadId}`}
            pluginId={slot.pluginId}
            slotKind="threadDetailsSection"
            slotId={slot.id}
            instanceId={threadId}
            crashFallback={null}
          >
            <section aria-label={slot.title} className="min-w-0 empty:hidden">
              <Component
                threadId={threadId}
                projectId={projectId}
                environmentId={environmentId}
                closeDetails={closeDetails}
              />
            </section>
          </PluginSlotMount>
        );
      })}
    </>
  );
}
