import { Button } from "@bb/shared-ui/button";
import { SplitButton } from "@/components/ui/split-button";
import type { ThreadWorkflowAction } from "@/lib/thread-workflow-action";

export function ShipWorkflowActions({
  actions,
}: {
  actions: readonly ThreadWorkflowAction[];
}) {
  const [primaryAction, ...secondaryActions] = actions;
  if (primaryAction === undefined) return null;

  return (
    <div className="px-2 pb-1 pt-2">
      {secondaryActions.length === 0 ? (
        <Button
          type="button"
          size="sm"
          className="h-10 w-full text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
          disabled={primaryAction.disabled}
          onClick={primaryAction.onSelect}
        >
          {primaryAction.label}
        </Button>
      ) : (
        <div className="[&>div]:w-full [&>div>button:first-child]:min-w-0 [&>div>button:first-child]:flex-1">
          <SplitButton
            disabled={primaryAction.disabled}
            className="h-10 text-xs transition-transform duration-150 ease-out active:scale-[0.96] motion-reduce:transition-none"
            primaryAction={primaryAction}
            primaryTooltip={primaryAction.tooltip}
            secondaryActions={secondaryActions}
            triggerLabel="Choose merge method"
          />
        </div>
      )}
    </div>
  );
}
