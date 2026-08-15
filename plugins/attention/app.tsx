import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { AttentionItem, AttentionState, rpcContract } from "./server";
import { Button } from "@bb/shared-ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@bb/shared-ui/card";

const WORKER_PATH = "/api/v1/plugins/attention/http/worker.js";
const WORKER_SCOPE = "/api/v1/plugins/attention/http/";
const SEEN_STORAGE_KEY = "bb-attention-seen-v1";

type DeliveryStatus = {
  permission: NotificationPermission | "unsupported";
  pushEnabled: boolean;
  pushSupported: boolean;
};

type RpcEnvelope<T> =
  | { ok: true; result: T }
  | { ok: false; error: { message?: string } };

function deviceLabel(): string {
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return coarse ? "Mobile browser" : "Desktop browser";
}

function subscriptionInput(subscription: PushSubscription) {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }
  return {
    endpoint: json.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
}

function urlBase64ToBytes(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes.buffer as ArrayBuffer;
}

async function ensureWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return null;
  return navigator.serviceWorker.register(WORKER_PATH, { scope: WORKER_SCOPE });
}

async function deliveryStatus(): Promise<DeliveryStatus> {
  const permission =
    "Notification" in window ? Notification.permission : "unsupported";
  const registration =
    "serviceWorker" in navigator
      ? await navigator.serviceWorker.getRegistration(WORKER_SCOPE)
      : null;
  const pushSupported = Boolean(registration && "pushManager" in registration);
  const subscription = pushSupported
    ? await registration!.pushManager.getSubscription()
    : null;
  return { permission, pushEnabled: Boolean(subscription), pushSupported };
}

function useAttentionState() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<AttentionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await rpc.call("state"));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [rpc]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime("attention.changed", () => void refresh());

  return { state, error, refresh, rpc };
}

function kindLabel(item: AttentionItem): string {
  if (item.kind === "failed") return "Failed";
  if (item.kind === "waiting") return "Waiting for input";
  return "Completed";
}

function AttentionPanel() {
  const { state, error, refresh, rpc } = useAttentionState();
  const navigate = useBbNavigate();

  const openItem = async (item: AttentionItem) => {
    await rpc.call("acknowledge", { threadId: item.threadId });
    navigate.toThread(item.threadId);
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Completed agents and threads waiting for you, oldest first.
          </p>
          {state && state.items.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void rpc.call("clearAll").then(() => refresh());
              }}
            >
              Mark all read
            </Button>
          ) : null}
        </div>

        {error ? (
          <Card>
            <CardContent className="pt-6 text-sm text-destructive">
              {error}
            </CardContent>
          </Card>
        ) : null}

        {!state ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              Loading attention queue…
            </CardContent>
          </Card>
        ) : state.items.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>You’re caught up</CardTitle>
              <CardDescription>
                New completions will appear here and can be opened with ⌥L.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-2">
            {state.items.map((item) => (
              <button
                key={`${item.threadId}:${item.attentionAt}`}
                type="button"
                className="flex w-full items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
                onClick={() => void openItem(item)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {kindLabel(item)}
                    {item.summary ? ` · ${item.summary}` : ""}
                  </span>
                </span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                  Open
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationSettings() {
  const { state, error, refresh, rpc } = useAttentionState();
  const [delivery, setDelivery] = useState<DeliveryStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshDelivery = useCallback(async () => {
    try {
      setDelivery(await deliveryStatus());
    } catch {
      setDelivery({
        permission:
          "Notification" in window ? Notification.permission : "unsupported",
        pushEnabled: false,
        pushSupported: false,
      });
    }
  }, []);

  useEffect(() => {
    void ensureWorker()
      .catch(() => null)
      .finally(() => refreshDelivery());
  }, [refreshDelivery]);

  const enableThisDevice = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (!("Notification" in window)) {
        throw new Error("This browser does not expose system notifications.");
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        throw new Error("Notification permission was not granted.");
      }

      const registration = await ensureWorker().catch(() => null);
      if (registration && "pushManager" in registration && state) {
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToBytes(state.vapidPublicKey),
          }));
        const input = subscriptionInput(subscription);
        await rpc.call("registerPush", {
          subscription: input,
          deviceLabel: deviceLabel(),
        });
        const test = await rpc.call("testPush", { endpoint: input.endpoint });
        setMessage(test.message);
      } else if (registration) {
        await registration.showNotification("BB notifications are ready", {
          body: "Keep BB open to receive live agent notifications.",
        });
        setMessage(
          "Live notifications are enabled; background push is unavailable in this browser.",
        );
      } else {
        new Notification("BB notifications are ready", {
          body: "Keep BB open to receive live agent notifications.",
        });
        setMessage(
          "Live notifications are enabled; background push is unavailable in this browser.",
        );
      }
      await Promise.all([refresh(), refreshDelivery()]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const disconnectThisDevice = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const registration =
        "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration(WORKER_SCOPE)
          : null;
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;
      if (subscription) {
        await rpc.call("unregisterPush", { endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setMessage("Background notifications were disconnected on this device.");
      await Promise.all([refresh(), refreshDelivery()]);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ?? false;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Delivery on this device</CardTitle>
          <CardDescription>
            Desktop uses native browser notifications. Mobile background push
            works when bb is added to the home screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <span>Permission: {delivery?.permission ?? "checking"}</span>
            <span>
              Background push: {delivery?.pushEnabled ? "connected" : "off"}
            </span>
            <span>
              Registered devices: {state?.pushSubscriptionCount ?? "—"}
            </span>
            <span>Shortcut: ⌥L</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void enableThisDevice()}>
              {busy ? "Working…" : "Enable and test"}
            </Button>
            {delivery?.pushEnabled ? (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void disconnectThisDevice()}
              >
                Disconnect this device
              </Button>
            ) : null}
          </div>
          {!standalone && delivery?.pushSupported ? (
            <p className="text-xs text-muted-foreground">
              On iPhone or iPad, use Share → Add to Home Screen, open bb from
              that icon, then enable notifications here.
            </p>
          ) : null}
          {message ? (
            <p className="text-sm text-foreground">{message}</p>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

async function rawRpc<T>(method: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/v1/plugins/attention/rpc/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const envelope = (await response.json()) as RpcEnvelope<T>;
  if (!envelope.ok) {
    throw new Error(envelope.error.message || `Attention RPC ${method} failed`);
  }
  return envelope.result;
}

function findThreadRow(threadId: string): HTMLElement | null {
  for (const element of Array.from(
    document.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"),
  )) {
    if (element.dataset.sidebarThreadId === threadId) return element;
  }
  return null;
}

function readSeen(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, number>): void {
  const entries = Object.entries(seen)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 250);
  localStorage.setItem(
    SEEN_STORAGE_KEY,
    JSON.stringify(Object.fromEntries(entries)),
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "attention-notifications",
    mount({ signal }) {
      let state: AttentionState | null = null;
      let initialized = false;
      let polling = false;
      let cycling = false;
      let usesPush = false;
      let pendingOpenThread: string | null = null;
      let statusNode: HTMLDivElement | null = null;
      let statusTimer: number | null = null;
      const seen = readSeen();

      const showStatus = (text: string) => {
        statusNode?.remove();
        if (statusTimer !== null) window.clearTimeout(statusTimer);
        const node = document.createElement("div");
        node.setAttribute("role", "status");
        node.textContent = text;
        Object.assign(node.style, {
          position: "fixed",
          left: "50%",
          bottom: "24px",
          transform: "translateX(-50%)",
          zIndex: "2147483647",
          padding: "8px 12px",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          boxShadow: "0 8px 30px rgba(0, 0, 0, 0.18)",
          fontSize: "13px",
          fontFamily: "inherit",
        });
        document.body.append(node);
        statusNode = node;
        statusTimer = window.setTimeout(() => {
          node.remove();
          if (statusNode === node) statusNode = null;
        }, 2400);
      };

      const acknowledgeAndOpen = async (threadId: string): Promise<boolean> => {
        const row = findThreadRow(threadId);
        if (!row) return false;
        row.click();
        await rawRpc("acknowledge", { threadId });
        return true;
      };

      const tryPendingOpen = async () => {
        if (!pendingOpenThread) return;
        if (await acknowledgeAndOpen(pendingOpenThread)) {
          pendingOpenThread = null;
          const url = new URL(window.location.href);
          if (url.searchParams.has("bbAttentionThread")) {
            url.searchParams.delete("bbAttentionThread");
            window.history.replaceState(window.history.state, "", url);
          }
        }
      };

      const showLocalNotification = async (item: AttentionItem) => {
        if (
          !("Notification" in window) ||
          Notification.permission !== "granted"
        ) {
          return;
        }
        const focused =
          document.visibilityState === "visible" && document.hasFocus();
        if (focused && !state?.settings.notifyWhileFocused) return;

        const body =
          state?.settings.showPreview && item.summary
            ? item.summary
            : item.kind === "failed"
              ? "The agent stopped with an error."
              : item.kind === "waiting"
                ? "The agent is waiting for your input."
                : "The agent finished and is ready for you.";
        const options: NotificationOptions = {
          body,
          tag: `bb-attention-${item.threadId}`,
          data: { threadId: item.threadId },
          silent: !state?.settings.sound,
        };
        const registration = await ensureWorker().catch(() => null);
        if (registration) {
          await registration.showNotification(item.title, options);
          return;
        }
        const notification = new Notification(item.title, options);
        notification.onclick = () => {
          window.focus();
          pendingOpenThread = item.threadId;
          void tryPendingOpen();
        };
      };

      const syncPushSubscription = async () => {
        const registration = await ensureWorker();
        if (!registration || !("pushManager" in registration)) return;
        const subscription = await registration.pushManager.getSubscription();
        usesPush = Boolean(subscription);
        if (subscription) {
          await rawRpc("registerPush", {
            subscription: subscriptionInput(subscription),
            deviceLabel: deviceLabel(),
          });
        }
      };

      const poll = async () => {
        if (polling || signal.aborted) return;
        polling = true;
        try {
          const next = await rawRpc<AttentionState>("state", null);
          state = next;
          if (!initialized) {
            for (const item of next.items)
              seen[item.threadId] = item.attentionAt;
            writeSeen(seen);
            initialized = true;
          } else {
            for (const item of next.items) {
              if ((seen[item.threadId] ?? 0) >= item.attentionAt) continue;
              seen[item.threadId] = item.attentionAt;
              writeSeen(seen);
              if (next.settings.notifications && !usesPush) {
                await showLocalNotification(item);
              }
            }
          }
          await tryPendingOpen();
        } catch {
          // The shared app reconnect UI owns connectivity feedback.
        } finally {
          polling = false;
        }
      };

      const cycle = async () => {
        if (cycling) return;
        cycling = true;
        try {
          state = await rawRpc<AttentionState>("state", null);
          const item = state.items[0];
          if (!item) {
            showStatus("No agents need your attention");
            return;
          }
          if (!(await acknowledgeAndOpen(item.threadId))) {
            showStatus("Open Attention from the sidebar to view this agent");
            return;
          }
          showStatus(
            state.items.length > 1
              ? `${state.items.length - 1} more needing attention`
              : "You’re caught up",
          );
          await poll();
        } catch (reason) {
          showStatus(
            reason instanceof Error ? reason.message : "Could not open agent",
          );
        } finally {
          cycling = false;
        }
      };

      const onKeyDown = (event: KeyboardEvent) => {
        if (
          state?.settings.shortcut &&
          event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          event.code === "KeyL"
        ) {
          event.preventDefault();
          event.stopPropagation();
          void cycle();
        }
      };

      const onWorkerMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; threadId?: unknown } | null;
        if (
          data?.type === "bb-attention-open-thread" &&
          typeof data.threadId === "string"
        ) {
          pendingOpenThread = data.threadId;
          void tryPendingOpen();
        } else if (data?.type === "bb-attention-changed") {
          void poll();
        }
      };

      const queryThread = new URL(window.location.href).searchParams.get(
        "bbAttentionThread",
      );
      if (queryThread) pendingOpenThread = queryThread;

      document.addEventListener("keydown", onKeyDown, {
        capture: true,
        signal,
      });
      navigator.serviceWorker?.addEventListener("message", onWorkerMessage, {
        signal,
      });

      void syncPushSubscription().catch(() => undefined);
      void poll();
      const interval = window.setInterval(() => void poll(), 2_000);

      return () => {
        window.clearInterval(interval);
        if (statusTimer !== null) window.clearTimeout(statusTimer);
        statusNode?.remove();
      };
    },
  });

  app.slots.navPanel({
    id: "attention-inbox",
    title: "Attention",
    icon: "Bell",
    path: "attention",
    component: AttentionPanel,
  });

  app.slots.settingsSection({
    id: "notification-delivery",
    title: "Notification delivery",
    description:
      "Connect desktop and mobile devices for agent completion alerts.",
    component: NotificationSettings,
  });

  app.slots.sidebarFooterAction({
    id: "notification-settings",
    title: "Notification settings",
    icon: "Bell",
    run: ({ openSettings }) => openSettings(),
  });
});
