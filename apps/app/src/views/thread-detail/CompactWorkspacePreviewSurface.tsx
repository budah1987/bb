import { Skeleton } from "@bb/shared-ui/skeleton";
import type { PaneContent } from "@/lib/split-layout";
import { usePluginSlots } from "@/lib/plugin-slots";
import { describePaneContent } from "./compactWorkspaceLabels";

/**
 * The surface that slides in under the finger. It is drawn from pane metadata
 * alone — no thread, plugin, or compose runtime is mounted mid-gesture, so a
 * drag can never autofocus a composer, open a secondary panel, start a terminal,
 * or duplicate a subscription. The real destination mounts only after commit.
 *
 * Everything here is non-focusable and the host marks the layer `aria-hidden`,
 * so assistive technology and the tab ring keep seeing exactly one surface.
 */
export function CompactWorkspacePreviewSurface({
  content,
  kind,
}: {
  /** `null` previews the Command Center (the root compose page). */
  content: PaneContent | null;
  kind?: "pane" | "conversation" | "command-center" | "right-panel" | "return";
}) {
  if (kind === "right-panel") {
    return <RightPanelShell />;
  }
  if (kind === "conversation") {
    return <ThreadShell />;
  }
  if (content === null || content.kind === "new-thread") {
    return <CommandCenterShell />;
  }
  if (content.kind === "thread") {
    return <ThreadShell />;
  }
  return <PanelShell content={content} />;
}

function RightPanelShell() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ShellHeader label="Right panel" />
      <div className="grid grid-cols-3 gap-2">
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-8 rounded-md" />
      </div>
      <Skeleton className="min-h-0 flex-1 rounded-lg" />
    </div>
  );
}

function ShellHeader({ label }: { label: string }) {
  return (
    <div className="flex h-10 shrink-0 items-center">
      <p className="truncate text-sm font-normal text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

/** A blank composer outline: the shape of the control, none of its behavior. */
function ComposerShell({ hint }: { hint: string }) {
  return (
    <div className="mt-auto shrink-0 rounded-xl border border-border-seam p-3">
      <p className="text-sm text-muted-foreground/60">{hint}</p>
    </div>
  );
}

function CommandCenterShell() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ShellHeader label="New thread" />
      <ComposerShell hint="Message" />
      <div className="flex shrink-0 flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground/75">Recent</p>
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-3/4 rounded-md" />
      </div>
    </div>
  );
}

function ThreadShell() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ShellHeader label="Thread" />
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <Skeleton className="h-4 w-2/3 rounded-md" />
        <Skeleton className="h-16 w-full rounded-md" />
        <Skeleton className="h-4 w-1/2 rounded-md" />
      </div>
      <ComposerShell hint="Reply" />
    </div>
  );
}

/**
 * Names the panel from the already-registered nav slots — a synchronous store
 * read, never the plugin's own component or runtime.
 */
function PanelShell({
  content,
}: {
  content: Extract<PaneContent, { kind: "plugin-panel" }>;
}) {
  const { navPanels } = usePluginSlots();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <ShellHeader label={describePaneContent(content, navPanels)} />
      <Skeleton className="min-h-0 flex-1 rounded-lg" />
    </div>
  );
}
