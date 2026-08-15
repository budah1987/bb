import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Button } from "../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Icon } from "../components/ui/icon";
import { Input } from "../components/ui/input";
import { threadDisplayTitle } from "./projection";

export function ConversationActionMenu({
  thread,
  children,
  onContinueInNewTab,
  onRename,
  onSetRead,
  onArchive,
  onDelete,
}: {
  thread: PluginSidebarThread;
  children: ReactNode;
  onContinueInNewTab?: () => void;
  onRename: () => void;
  onSetRead: (read: boolean) => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const title = threadDisplayTitle(thread);
  const isExplicitlyRead = thread.lastReadAt === thread.latestAttentionAt;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${title} actions`}>
        {onContinueInNewTab ? (
          <>
            <ContextMenuItem onSelect={onContinueInNewTab}>
              <Icon name="Fork" aria-hidden />
              Continue in new tab
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        ) : null}
        <ContextMenuItem onSelect={() => onSetRead(!isExplicitlyRead)}>
          <Icon name={isExplicitlyRead ? "Mail" : "MailOpen"} aria-hidden />
          {isExplicitlyRead ? "Mark as unread" : "Mark as read"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onRename}>
          <Icon name="Edit" aria-hidden />
          Rename…
        </ContextMenuItem>
        <ContextMenuItem onSelect={onArchive}>
          <Icon name="Archive" aria-hidden />
          Archive
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive-text focus:text-destructive-text"
          onSelect={onDelete}
        >
          <Icon name="Trash2" aria-hidden />
          Delete…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function RenameConversationDialog({
  thread,
  onClose,
  onRename,
}: {
  thread: PluginSidebarThread | null;
  onClose: () => void;
  onRename: (thread: PluginSidebarThread, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setTitle(thread ? threadDisplayTitle(thread) : "");
    setError(null);
    setIsSaving(false);
  }, [thread]);

  if (!thread) return null;
  const currentThread = thread;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setIsSaving(true);
    setError(null);
    try {
      await onRename(currentThread, nextTitle);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rename failed.");
      setIsSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>
              Changes this conversation’s name everywhere it appears in BB.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-xs font-medium text-foreground">
            <span>Conversation name</span>
            <Input
              autoFocus
              value={title}
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? "conductor-conversation-rename-error" : undefined
              }
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error ? (
            <p
              id="conductor-conversation-rename-error"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSaving || title.trim().length === 0}
            >
              {isSaving ? "Renaming…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function pickDeleteFallbackThread(
  threads: readonly PluginSidebarThread[],
  deletedThreadId: string,
): PluginSidebarThread | null {
  const deletedIndex = threads.findIndex(
    (thread) => thread.id === deletedThreadId,
  );
  if (deletedIndex < 0) return null;
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  const isDeletedWithTarget = (candidate: PluginSidebarThread): boolean => {
    let parentId = candidate.parentThreadId;
    const visited = new Set<string>();
    while (parentId !== null && !visited.has(parentId)) {
      if (parentId === deletedThreadId) return true;
      visited.add(parentId);
      parentId = threadsById.get(parentId)?.parentThreadId ?? null;
    }
    return false;
  };

  for (let index = deletedIndex + 1; index < threads.length; index += 1) {
    const candidate = threads[index];
    if (candidate && !isDeletedWithTarget(candidate)) return candidate;
  }
  for (let index = deletedIndex - 1; index >= 0; index -= 1) {
    const candidate = threads[index];
    if (candidate && !isDeletedWithTarget(candidate)) return candidate;
  }
  return null;
}
