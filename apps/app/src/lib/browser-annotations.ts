import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { BbDesktopBrowserAnnotationDraft } from "@bb/desktop-contract";
import type { BrowserAnnotation } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { useThreadAnnotations } from "@/hooks/queries/thread-annotations-query";

/** Kept for plugins that imported the former local-storage adapter. */
export const BROWSER_ANNOTATIONS_STORAGE_VERSION = 2;
/** @deprecated Browser annotations now persist on the BB server. */
export const BROWSER_ANNOTATIONS_STORAGE_KEY_PREFIX =
  "bb:browser-annotations:server:";

export type BrowserAnnotationStatus = "open" | "sent" | "resolved";

export interface BrowserAnnotationDraft {
  id: string;
  threadId: string;
  environmentId: string | null;
  tabId: string;
  selector: string;
  url: string;
  viewport: BbDesktopBrowserAnnotationDraft["viewport"];
  rectangle: BbDesktopBrowserAnnotationDraft["rectangle"];
  comment: string;
  status: BrowserAnnotationStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserAnnotationSnapshot {
  drafts: readonly BrowserAnnotationDraft[];
  selectedId: string | null;
}

export interface BrowserAnnotationPersistenceError {
  draftId: string | null;
  id: number;
  message: string;
  operation: "create" | "delete" | "update";
  retry: () => void;
  tabId: string;
}

export interface BrowserAnnotationSelection {
  tabId: string;
  threadId: string;
}

interface UpdateBrowserAnnotationDraft {
  comment: string;
}

type Listener = () => void;
type SelectionListener = (selection: BrowserAnnotationSelection) => void;

const selectionListeners = new Set<SelectionListener>();

const EMPTY_SNAPSHOT: BrowserAnnotationSnapshot = {
  drafts: [],
  selectedId: null,
};
const EMPTY_PERSISTENCE_ERRORS: BrowserAnnotationPersistenceError[] = [];

function scopeKey(threadId: string, tabId: string): string {
  return `${threadId}\u0000${tabId}`;
}

function fromServer(annotation: BrowserAnnotation): BrowserAnnotationDraft {
  return {
    ...annotation,
    tabId: annotation.browserTabId,
  };
}

function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `pending:${crypto.randomUUID()}`;
  }
  return `pending:${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class BrowserAnnotationStore {
  private readonly listeners = new Set<Listener>();
  private readonly snapshots = new Map<string, BrowserAnnotationSnapshot>();
  private readonly threadSnapshots = new Map<
    string,
    BrowserAnnotationSnapshot
  >();
  private readonly persistenceErrors = new Map<
    string,
    Map<string, BrowserAnnotationPersistenceError>
  >();
  private readonly persistenceErrorSnapshots = new Map<
    string,
    BrowserAnnotationPersistenceError[]
  >();
  private readonly pendingCreateTasks = new Map<string, Promise<boolean>>();
  private readonly persistenceErrorListeners = new Set<Listener>();
  private nextPersistenceErrorId = 1;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribePersistenceErrors = (listener: Listener): (() => void) => {
    this.persistenceErrorListeners.add(listener);
    return () => this.persistenceErrorListeners.delete(listener);
  };

  getPersistenceError(
    threadId: string,
  ): BrowserAnnotationPersistenceError | null {
    return this.getPersistenceErrors(threadId)[0] ?? null;
  }

  getPersistenceErrors(threadId: string): BrowserAnnotationPersistenceError[] {
    return (
      this.persistenceErrorSnapshots.get(threadId) ?? EMPTY_PERSISTENCE_ERRORS
    );
  }

  clearPersistenceError(threadId: string): void {
    if (!this.persistenceErrors.has(threadId)) return;
    this.persistenceErrors.delete(threadId);
    this.persistenceErrorSnapshots.delete(threadId);
    this.emitPersistenceError();
  }

  retryPersistenceErrors(threadId: string): void {
    for (const error of this.getPersistenceErrors(threadId)) error.retry();
  }

  syncServerDrafts(
    threadId: string,
    annotations: readonly BrowserAnnotation[],
    browserTabId?: string,
  ): void {
    const serverDrafts = annotations.map(fromServer);
    const tabIds =
      browserTabId === undefined
        ? new Set([
            ...serverDrafts.map((draft) => draft.tabId),
            ...[...this.snapshots.keys()]
              .filter((key) => key.startsWith(`${threadId}\u0000`))
              .map((key) => key.split("\u0000")[1])
              .filter((tabId): tabId is string => tabId !== undefined),
          ])
        : new Set([browserTabId]);
    for (const tabId of tabIds) {
      const current = this.snapshots.get(scopeKey(threadId, tabId));
      const pending =
        current?.drafts.filter((draft) => draft.id.startsWith("pending:")) ??
        [];
      this.snapshots.set(scopeKey(threadId, tabId), {
        drafts: [
          ...serverDrafts.filter((draft) => draft.tabId === tabId),
          ...pending,
        ],
        selectedId: current?.selectedId ?? null,
      });
    }
    this.emit(threadId);
  }

  getSnapshot(threadId: string, tabId: string): BrowserAnnotationSnapshot {
    return this.snapshots.get(scopeKey(threadId, tabId)) ?? EMPTY_SNAPSHOT;
  }

  getThreadSnapshot(threadId: string): BrowserAnnotationSnapshot {
    const existing = this.threadSnapshots.get(threadId);
    if (existing !== undefined) return existing;
    const drafts = [...this.snapshots.entries()]
      .filter(([key]) => key.startsWith(`${threadId}\u0000`))
      .flatMap(([, snapshot]) => snapshot.drafts)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const selectedId =
      [...this.snapshots.entries()]
        .filter(([key]) => key.startsWith(`${threadId}\u0000`))
        .map(([, snapshot]) => snapshot.selectedId)
        .find((id) => id !== null) ?? null;
    const snapshot = { drafts, selectedId };
    this.threadSnapshots.set(threadId, snapshot);
    return snapshot;
  }

  addDraft(
    threadId: string,
    draft: BbDesktopBrowserAnnotationDraft,
    environmentId: string | null = null,
  ): BrowserAnnotationDraft {
    const now = new Date().toISOString();
    const record: BrowserAnnotationDraft = {
      ...draft,
      id: createDraftId(),
      threadId,
      environmentId,
      status: "open",
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    const snapshot =
      this.snapshots.get(scopeKey(threadId, draft.tabId)) ?? EMPTY_SNAPSHOT;
    this.commit(threadId, draft.tabId, {
      drafts: [...snapshot.drafts, record],
      selectedId: record.id,
    });
    void this.startPersistCreate(record);
    return record;
  }

  private startPersistCreate(record: BrowserAnnotationDraft): Promise<boolean> {
    const existing = this.pendingCreateTasks.get(record.id);
    if (existing !== undefined) return existing;
    const task = this.persistCreate(record).finally(() => {
      if (this.pendingCreateTasks.get(record.id) === task) {
        this.pendingCreateTasks.delete(record.id);
      }
    });
    this.pendingCreateTasks.set(record.id, task);
    return task;
  }

  private async persistCreate(
    record: BrowserAnnotationDraft,
  ): Promise<boolean> {
    try {
      const created = await sdk.threads.annotations.create({
        threadId: record.threadId,
        environmentId: record.environmentId,
        browserTabId: record.tabId,
        url: record.url,
        selector: record.selector,
        viewport: record.viewport,
        rectangle: record.rectangle,
        comment: record.comment,
        status: record.status,
      });
      const current = this.findDraft(record.threadId, record.tabId, record.id);
      const saved = fromServer(created);
      this.replacePending(record, saved);
      this.clearPersistenceErrorForTarget(
        record.threadId,
        record.tabId,
        record.id,
        "create",
      );
      if (current === undefined) return true;
      const shouldUpdateComment = current.comment !== saved.comment;
      const shouldUpdateStatus = current.status !== saved.status;
      if (!shouldUpdateComment && !shouldUpdateStatus) return true;
      try {
        const updated = await sdk.threads.annotations.update({
          annotationId: saved.id,
          threadId: saved.threadId,
          expectedRevision: saved.revision,
          ...(shouldUpdateComment ? { comment: current.comment } : {}),
          ...(shouldUpdateStatus ? { status: current.status } : {}),
        });
        this.replaceDraft(fromServer(updated));
        this.clearPersistenceErrorForTarget(
          saved.threadId,
          saved.tabId,
          saved.id,
          "update",
        );
        return true;
      } catch (error: unknown) {
        this.reportPersistenceError(
          saved.threadId,
          saved.tabId,
          saved.id,
          "update",
          error,
          () => {
            if (shouldUpdateStatus) {
              void this.setStatus(
                saved.threadId,
                saved.tabId,
                saved.id,
                current.status,
              );
            } else {
              this.updateDraft(saved.threadId, saved.tabId, saved.id, {
                comment: current.comment,
              });
            }
          },
        );
        return false;
      }
    } catch (error: unknown) {
      this.reportPersistenceError(
        record.threadId,
        record.tabId,
        record.id,
        "create",
        error,
        () => {
          const current = this.findDraft(
            record.threadId,
            record.tabId,
            record.id,
          );
          if (current !== undefined) void this.startPersistCreate(current);
        },
      );
      return false;
    }
  }

  updateDraft(
    threadId: string,
    tabId: string,
    id: string,
    update: UpdateBrowserAnnotationDraft,
  ): void {
    const comment = update.comment.trim();
    if (comment.length === 0) return;
    const draft = this.findDraft(threadId, tabId, id);
    if (draft === undefined) return;
    this.changeDraft(threadId, tabId, id, (current) => ({
      ...current,
      comment,
      updatedAt: new Date().toISOString(),
    }));
    if (id.startsWith("pending:")) return;
    void sdk.threads.annotations
      .update({
        annotationId: id,
        threadId,
        expectedRevision: draft.revision,
        comment,
      })
      .then((saved) => {
        this.replaceDraft(fromServer(saved));
        this.clearPersistenceErrorForTarget(threadId, tabId, id, "update");
      })
      .catch((error: unknown) => {
        this.replaceDraft(draft);
        this.reportPersistenceError(threadId, tabId, id, "update", error, () =>
          this.updateDraft(threadId, tabId, id, update),
        );
      });
  }

  resolveDraft(threadId: string, tabId: string, id: string): Promise<boolean> {
    return this.setStatus(threadId, tabId, id, "resolved");
  }

  reopenDraft(threadId: string, tabId: string, id: string): Promise<boolean> {
    return this.setStatus(threadId, tabId, id, "open");
  }

  markSent(threadId: string, tabId: string, id: string): Promise<boolean> {
    return this.setStatus(threadId, tabId, id, "sent");
  }

  removeDraft(threadId: string, tabId: string, id: string): void {
    const draft = this.findDraft(threadId, tabId, id);
    if (draft === undefined) return;
    const snapshot =
      this.snapshots.get(scopeKey(threadId, tabId)) ?? EMPTY_SNAPSHOT;
    this.commit(threadId, tabId, {
      drafts: snapshot.drafts.filter((candidate) => candidate.id !== id),
      selectedId: snapshot.selectedId === id ? null : snapshot.selectedId,
    });
    if (id.startsWith("pending:")) return;
    void sdk.threads.annotations
      .delete({
        annotationId: id,
        expectedRevision: draft.revision,
        threadId,
      })
      .then(() =>
        this.clearPersistenceErrorForTarget(threadId, tabId, id, "delete"),
      )
      .catch((error: unknown) => {
        this.commit(threadId, tabId, snapshot);
        this.reportPersistenceError(threadId, tabId, id, "delete", error, () =>
          this.removeDraft(threadId, tabId, id),
        );
      });
  }

  clearDrafts(threadId: string, tabId?: string): void {
    if (tabId !== undefined) {
      this.commit(threadId, tabId, EMPTY_SNAPSHOT);
    } else {
      for (const key of [...this.snapshots.keys()]) {
        const [scopeThreadId, scopeTabId] = key.split("\u0000");
        if (scopeThreadId === threadId && scopeTabId !== undefined) {
          this.commit(threadId, scopeTabId, EMPTY_SNAPSHOT, false);
        }
      }
      this.emit(threadId);
    }
    void sdk.threads.annotations
      .clear({
        threadId,
        browserTabId: tabId ?? null,
        ids: null,
      })
      .then(() =>
        this.clearPersistenceErrorForTarget(
          threadId,
          tabId ?? "",
          null,
          "delete",
        ),
      )
      .catch((error: unknown) => {
        this.reportPersistenceError(
          threadId,
          tabId ?? "",
          null,
          "delete",
          error,
          () => this.clearDrafts(threadId, tabId),
        );
      });
  }

  selectDraft(threadId: string, tabId: string, id: string | null): void {
    for (const key of [...this.snapshots.keys()]) {
      const [scopeThreadId, scopeTabId] = key.split("\u0000");
      if (scopeThreadId !== threadId || scopeTabId === undefined) continue;
      const snapshot = this.snapshots.get(key) ?? EMPTY_SNAPSHOT;
      const selectedId = scopeTabId === tabId ? id : null;
      if (snapshot.selectedId !== selectedId) {
        this.commit(threadId, scopeTabId, { ...snapshot, selectedId }, false);
      }
    }
    this.emit(threadId);
    if (id !== null) {
      for (const listener of selectionListeners) {
        listener({ tabId, threadId });
      }
    }
  }

  private setStatus(
    threadId: string,
    tabId: string,
    id: string,
    status: BrowserAnnotationStatus,
  ): Promise<boolean> {
    const draft = this.findDraft(threadId, tabId, id);
    if (draft === undefined) return Promise.resolve(false);
    this.changeDraft(threadId, tabId, id, (current) => ({
      ...current,
      status,
      updatedAt: new Date().toISOString(),
    }));
    if (id.startsWith("pending:")) {
      const current = this.findDraft(threadId, tabId, id);
      return current === undefined
        ? Promise.resolve(false)
        : this.startPersistCreate(current);
    }
    return sdk.threads.annotations
      .update({
        annotationId: id,
        threadId,
        expectedRevision: draft.revision,
        status,
      })
      .then((saved) => {
        this.replaceDraft(fromServer(saved));
        this.clearPersistenceErrorForTarget(threadId, tabId, id, "update");
        return true;
      })
      .catch((error: unknown) => {
        this.replaceDraft(draft);
        this.reportPersistenceError(
          threadId,
          tabId,
          id,
          "update",
          error,
          () => void this.setStatus(threadId, tabId, id, status),
        );
        return false;
      });
  }

  private findDraft(
    threadId: string,
    tabId: string,
    id: string,
  ): BrowserAnnotationDraft | undefined {
    return this.snapshots
      .get(scopeKey(threadId, tabId))
      ?.drafts.find((draft) => draft.id === id);
  }

  private changeDraft(
    threadId: string,
    tabId: string,
    id: string,
    change: (draft: BrowserAnnotationDraft) => BrowserAnnotationDraft,
  ): void {
    const snapshot =
      this.snapshots.get(scopeKey(threadId, tabId)) ?? EMPTY_SNAPSHOT;
    if (!snapshot.drafts.some((draft) => draft.id === id)) return;
    this.commit(threadId, tabId, {
      ...snapshot,
      drafts: snapshot.drafts.map((draft) =>
        draft.id === id ? change(draft) : draft,
      ),
    });
  }

  private replacePending(
    pending: BrowserAnnotationDraft,
    saved: BrowserAnnotationDraft,
  ): void {
    const snapshot = this.snapshots.get(
      scopeKey(pending.threadId, pending.tabId),
    );
    if (snapshot === undefined) return;
    this.commit(pending.threadId, pending.tabId, {
      drafts: snapshot.drafts.map((draft) =>
        draft.id === pending.id ? saved : draft,
      ),
      selectedId:
        snapshot.selectedId === pending.id ? saved.id : snapshot.selectedId,
    });
  }

  private replaceDraft(saved: BrowserAnnotationDraft): void {
    const snapshot = this.snapshots.get(scopeKey(saved.threadId, saved.tabId));
    if (snapshot === undefined) return;
    this.commit(saved.threadId, saved.tabId, {
      ...snapshot,
      drafts: snapshot.drafts.map((draft) =>
        draft.id === saved.id ? saved : draft,
      ),
    });
  }

  private commit(
    threadId: string,
    tabId: string,
    snapshot: BrowserAnnotationSnapshot,
    emit = true,
  ): void {
    this.snapshots.set(scopeKey(threadId, tabId), snapshot);
    this.threadSnapshots.delete(threadId);
    if (emit) this.emit(threadId);
  }

  private emit(threadId: string): void {
    this.threadSnapshots.delete(threadId);
    for (const listener of this.listeners) listener();
  }

  private reportPersistenceError(
    threadId: string,
    tabId: string,
    draftId: string | null,
    operation: BrowserAnnotationPersistenceError["operation"],
    error: unknown,
    retry: () => void,
  ): void {
    const errors = this.persistenceErrors.get(threadId) ?? new Map();
    errors.set(this.persistenceErrorTargetKey(tabId, draftId, operation), {
      draftId,
      id: this.nextPersistenceErrorId++,
      message: error instanceof Error ? error.message : "Try again.",
      operation,
      retry,
      tabId,
    });
    this.persistenceErrors.set(threadId, errors);
    this.persistenceErrorSnapshots.set(threadId, [...errors.values()]);
    this.emitPersistenceError();
  }

  private clearPersistenceErrorForTarget(
    threadId: string,
    tabId: string,
    draftId: string | null,
    operation: BrowserAnnotationPersistenceError["operation"],
  ): void {
    const errors = this.persistenceErrors.get(threadId);
    if (errors === undefined) return;
    errors.delete(this.persistenceErrorTargetKey(tabId, draftId, operation));
    if (errors.size === 0) {
      this.persistenceErrors.delete(threadId);
      this.persistenceErrorSnapshots.delete(threadId);
    } else {
      this.persistenceErrorSnapshots.set(threadId, [...errors.values()]);
    }
    this.emitPersistenceError();
  }

  private persistenceErrorTargetKey(
    tabId: string,
    draftId: string | null,
    operation: BrowserAnnotationPersistenceError["operation"],
  ): string {
    return `${operation}\u0000${tabId}\u0000${draftId ?? "*"}`;
  }

  private emitPersistenceError(): void {
    for (const listener of this.persistenceErrorListeners) listener();
  }
}

export const browserAnnotationStore = new BrowserAnnotationStore();

export function subscribeBrowserAnnotationSelection(
  listener: SelectionListener,
): () => void {
  selectionListeners.add(listener);
  return () => selectionListeners.delete(listener);
}

export function useBrowserAnnotationPersistenceError(threadId: string) {
  const errors = useSyncExternalStore(
    browserAnnotationStore.subscribePersistenceErrors,
    () => browserAnnotationStore.getPersistenceErrors(threadId),
    () => [],
  );
  return {
    error: errors[0] ?? null,
    errorCount: errors.length,
    errors,
    clear: () => browserAnnotationStore.clearPersistenceError(threadId),
    retryAll: () => browserAnnotationStore.retryPersistenceErrors(threadId),
  };
}

export function useBrowserAnnotations(threadId: string, tabId: string) {
  const serverQuery = useThreadAnnotations(threadId, { browserTabId: tabId });
  useEffect(() => {
    if (serverQuery.data === undefined) return;
    browserAnnotationStore.syncServerDrafts(
      threadId,
      serverQuery.data.annotations,
      tabId,
    );
  }, [serverQuery.data, tabId, threadId]);
  const snapshot = useSyncExternalStore(
    browserAnnotationStore.subscribe,
    () => browserAnnotationStore.getSnapshot(threadId, tabId),
    () => EMPTY_SNAPSHOT,
  );
  return useMemo(
    () => ({
      ...snapshot,
      addDraft: (
        draft: BbDesktopBrowserAnnotationDraft,
        environmentId: string | null = null,
      ) => browserAnnotationStore.addDraft(threadId, draft, environmentId),
      updateDraft: (id: string, update: UpdateBrowserAnnotationDraft) =>
        browserAnnotationStore.updateDraft(threadId, tabId, id, update),
      resolveDraft: (id: string) =>
        browserAnnotationStore.resolveDraft(threadId, tabId, id),
      reopenDraft: (id: string) =>
        browserAnnotationStore.reopenDraft(threadId, tabId, id),
      markSent: (id: string) =>
        browserAnnotationStore.markSent(threadId, tabId, id),
      markSentDraft: (id: string) =>
        browserAnnotationStore.markSent(threadId, tabId, id),
      removeDraft: (id: string) =>
        browserAnnotationStore.removeDraft(threadId, tabId, id),
      clearDrafts: () => browserAnnotationStore.clearDrafts(threadId, tabId),
      selectDraft: (id: string | null) =>
        browserAnnotationStore.selectDraft(threadId, tabId, id),
    }),
    [snapshot, threadId, tabId],
  );
}

export function useThreadBrowserAnnotations(threadId: string) {
  const serverQuery = useThreadAnnotations(threadId);
  useEffect(() => {
    if (serverQuery.data === undefined) return;
    browserAnnotationStore.syncServerDrafts(
      threadId,
      serverQuery.data.annotations,
    );
  }, [serverQuery.data, threadId]);
  const snapshot = useSyncExternalStore(
    browserAnnotationStore.subscribe,
    () => browserAnnotationStore.getThreadSnapshot(threadId),
    () => EMPTY_SNAPSHOT,
  );
  return useMemo(
    () => ({
      ...snapshot,
      updateDraft: (id: string, update: UpdateBrowserAnnotationDraft) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        if (draft)
          browserAnnotationStore.updateDraft(threadId, draft.tabId, id, update);
      },
      resolveDraft: (id: string) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        return draft
          ? browserAnnotationStore.resolveDraft(threadId, draft.tabId, id)
          : Promise.resolve(false);
      },
      reopenDraft: (id: string) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        return draft
          ? browserAnnotationStore.reopenDraft(threadId, draft.tabId, id)
          : Promise.resolve(false);
      },
      markSent: (id: string) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        return draft
          ? browserAnnotationStore.markSent(threadId, draft.tabId, id)
          : Promise.resolve(false);
      },
      markSentDraft: (id: string) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        return draft
          ? browserAnnotationStore.markSent(threadId, draft.tabId, id)
          : Promise.resolve(false);
      },
      removeDraft: (id: string) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        if (draft)
          browserAnnotationStore.removeDraft(threadId, draft.tabId, id);
      },
      clearDrafts: () => browserAnnotationStore.clearDrafts(threadId),
      selectDraft: (id: string | null) => {
        const draft = snapshot.drafts.find((candidate) => candidate.id === id);
        if (id === null) {
          const first = snapshot.drafts[0];
          browserAnnotationStore.selectDraft(
            threadId,
            first?.tabId ?? "",
            null,
          );
        } else if (draft) {
          browserAnnotationStore.selectDraft(threadId, draft.tabId, id);
        }
      },
    }),
    [snapshot, threadId],
  );
}
