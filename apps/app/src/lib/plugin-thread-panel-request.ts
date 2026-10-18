import type { BbNavigate } from "@get-bb/plugin-sdk";

type OpenOptions = Parameters<BbNavigate["experimental_openThreadPanel"]>[0];
type OpenResult = Awaited<
  ReturnType<BbNavigate["experimental_openThreadPanel"]>
>;
type OpenOutcome = OpenResult["outcome"];

interface PendingRequest {
  id: number;
  options: OpenOptions;
  startRouteKey: string;
  expectedPath: string | null;
  isRouteCommitted: boolean;
  resolve: (result: OpenResult) => void;
  expiry: ReturnType<typeof setTimeout>;
}

const REQUEST_EXPIRY_MS = 10_000;
let nextRequestId = 0;
let pending: PendingRequest | null = null;
let currentRoute: { key: string; path: string } | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function finish(id: number, outcome: OpenOutcome): void {
  if (pending?.id !== id) return;
  const request = pending;
  pending = null;
  clearTimeout(request.expiry);
  request.resolve({ outcome });
  notify();
}

export function supersedePendingThreadPanelRequest(): void {
  if (pending !== null) finish(pending.id, "superseded");
}

export function startThreadPanelRequest(
  options: OpenOptions,
  route: { key: string; path: string },
): { id: number; result: Promise<OpenResult> } {
  supersedePendingThreadPanelRequest();
  currentRoute = route;
  const id = ++nextRequestId;
  const result = new Promise<OpenResult>((resolve) => {
    pending = {
      id,
      options,
      startRouteKey: route.key,
      expectedPath: null,
      isRouteCommitted: false,
      resolve,
      expiry: setTimeout(
        () => finish(id, "no-panel-surface"),
        REQUEST_EXPIRY_MS,
      ),
    };
  });
  notify();
  return { id, result };
}

export function isThreadPanelRequestPending(id: number): boolean {
  return pending?.id === id;
}

export function setThreadPanelRequestDestination(
  id: number,
  path: string,
): boolean {
  if (pending?.id !== id) return false;
  if (currentRoute !== null && currentRoute.key !== pending.startRouteKey) {
    finish(id, "no-panel-surface");
    return false;
  }
  pending.expectedPath = path;
  pending.isRouteCommitted = currentRoute?.path === path;
  notify();
  return true;
}

export function observeThreadPanelRoute(route: {
  key: string;
  path: string;
}): void {
  currentRoute = route;
  if (pending === null) return;
  if (pending.expectedPath === route.path) {
    pending.isRouteCommitted = true;
    notify();
    return;
  }
  if (route.key !== pending.startRouteKey) {
    finish(pending.id, "no-panel-surface");
  }
}

export function cancelThreadPanelRequestOnOwnerUnmount(): void {
  if (pending !== null) finish(pending.id, "no-panel-surface");
  currentRoute = null;
}

export function subscribeThreadPanelRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getReadyThreadPanelRequest(
  threadId: string,
): { id: number; options: OpenOptions } | null {
  if (
    pending === null ||
    !pending.isRouteCommitted ||
    pending.options.threadId !== threadId
  ) {
    return null;
  }
  return { id: pending.id, options: pending.options };
}

export function completeThreadPanelRequest(
  id: number,
  outcome: OpenOutcome,
): void {
  finish(id, outcome);
}
