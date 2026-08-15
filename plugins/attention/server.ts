import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import * as webpush from "web-push";
import { z } from "zod";

const VAPID_SUBJECT = "https://github.com/get-bb/bb";
const RECONCILE_INTERVAL_MS = 10_000;

const attentionKindSchema = z.enum(["completed", "failed", "waiting"]);

const attentionItemSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  providerId: z.string(),
  title: z.string(),
  kind: attentionKindSchema,
  summary: z.string().nullable(),
  attentionAt: z.number().int(),
});

const notificationSettingsSchema = z.object({
  notifications: z.boolean(),
  sound: z.boolean(),
  notifyWhileFocused: z.boolean(),
  shortcut: z.boolean(),
  showPreview: z.boolean(),
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  expirationTime: z.number().int().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(4096),
    auth: z.string().min(1).max(4096),
  }),
});

const stateSchema = z.object({
  items: z.array(attentionItemSchema),
  settings: notificationSettingsSchema,
  vapidPublicKey: z.string(),
  pushSubscriptionCount: z.number().int().nonnegative(),
});

export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type AttentionState = z.infer<typeof stateSchema>;

export const rpcContract = defineRpcContract({
  state: {
    input: z.null(),
    output: stateSchema,
  },
  acknowledge: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  clearAll: {
    input: z.null(),
    output: z.object({ cleared: z.number().int().nonnegative() }),
  },
  registerPush: {
    input: z
      .object({
        subscription: pushSubscriptionSchema,
        deviceLabel: z.string().min(1).max(120),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  unregisterPush: {
    input: z.object({ endpoint: z.string().url().max(4096) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  testPush: {
    input: z.object({ endpoint: z.string().url().max(4096) }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string() }),
  },
});

type ThreadListItem = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];

type VapidKeys = {
  publicKey: string;
  privateKey: string;
};

type PushRow = {
  endpoint: string;
  expiration_time: number | null;
  p256dh: string;
  auth: string;
  device_label: string;
};

type EventThread = {
  id: string;
  projectId: string;
  providerId: string;
  title: string | null;
  titleFallback: string | null;
  visibility: "visible" | "hidden";
  archivedAt: number | null;
  lastReadAt: number | null;
  latestAttentionAt: number;
};

function titleFor(thread: {
  title: string | null;
  titleFallback: string | null;
}): string {
  return (
    thread.title?.trim() || thread.titleFallback?.trim() || "Untitled agent"
  );
}

function compactSummary(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.length > 220 ? `${compact.slice(0, 217)}…` : compact;
}

function itemFromThread(
  thread: ThreadListItem,
  existing?: AttentionItem,
): AttentionItem {
  const kind: AttentionItem["kind"] = thread.hasPendingInteraction
    ? "waiting"
    : thread.status === "error"
      ? "failed"
      : "completed";

  return {
    threadId: thread.id,
    projectId: thread.projectId,
    providerId: thread.providerId,
    title: titleFor(thread),
    kind,
    summary:
      existing?.attentionAt === thread.latestAttentionAt
        ? existing.summary
        : null,
    attentionAt: thread.latestAttentionAt,
  };
}

function queueFingerprint(queue: ReadonlyMap<string, AttentionItem>): string {
  return JSON.stringify(
    [...queue.values()]
      .sort((left, right) => left.threadId.localeCompare(right.threadId))
      .map((item) => [item.threadId, item.kind, item.attentionAt, item.title]),
  );
}

function sortedItems(
  queue: ReadonlyMap<string, AttentionItem>,
): AttentionItem[] {
  return [...queue.values()].sort(
    (left, right) =>
      left.attentionAt - right.attentionAt ||
      left.threadId.localeCompare(right.threadId),
  );
}

function isUnread(thread: {
  latestAttentionAt: number;
  lastReadAt: number | null;
}): boolean {
  return thread.latestAttentionAt > (thread.lastReadAt ?? 0);
}

function isActionable(thread: ThreadListItem): boolean {
  return (
    thread.visibility === "visible" &&
    thread.archivedAt === null &&
    isUnread(thread) &&
    (thread.status === "idle" ||
      thread.status === "error" ||
      thread.hasPendingInteraction)
  );
}

function notificationCopy(
  item: AttentionItem,
  settings: z.infer<typeof notificationSettingsSchema>,
): { title: string; body: string } {
  const title = item.title;
  const genericBody =
    item.kind === "failed"
      ? "The agent stopped with an error."
      : item.kind === "waiting"
        ? "The agent is waiting for your input."
        : "The agent finished and is ready for you.";

  return {
    title,
    body: settings.showPreview && item.summary ? item.summary : genericBody,
  };
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

const serviceWorkerSource = String.raw`
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const visibleWindow = windows.find((client) => client.visibilityState === "visible");

    if (visibleWindow && !payload.notifyWhileFocused) {
      visibleWindow.postMessage({ type: "bb-attention-changed" });
      return;
    }

    await self.registration.showNotification(payload.title || "BB agent needs attention", {
      body: payload.body || "Open BB to continue.",
      tag: payload.threadId ? "bb-attention-" + payload.threadId : "bb-attention-test",
      data: { threadId: payload.threadId || null },
      silent: !payload.sound,
      renotify: true,
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const threadId = event.notification.data && event.notification.data.threadId;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length > 0) {
      const client = windows[0];
      await client.focus();
      client.postMessage({ type: "bb-attention-open-thread", threadId });
      return;
    }

    const suffix = threadId ? "?bbAttentionThread=" + encodeURIComponent(threadId) : "";
    await self.clients.openWindow("/" + suffix);
  })());
});
`;

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    notifications: {
      type: "boolean",
      label: "System notifications",
      default: true,
    },
    sound: {
      type: "boolean",
      label: "Notification sound",
      default: false,
    },
    notifyWhileFocused: {
      type: "boolean",
      label: "Notify while BB is focused",
      default: false,
    },
    shortcut: {
      type: "boolean",
      label: "Use Option+L to open the next agent",
      default: true,
    },
    showPreview: {
      type: "boolean",
      label: "Show assistant text in notifications",
      default: false,
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      expiration_time INTEGER,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      device_label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
  ]);

  const storedVapidKeys = await bb.storage.kv.get<VapidKeys>("vapid-keys");
  const vapidKeys: VapidKeys = storedVapidKeys ?? webpush.generateVAPIDKeys();
  if (!storedVapidKeys) {
    await bb.storage.kv.set("vapid-keys", vapidKeys);
  }

  const queue = new Map<string, AttentionItem>();

  const listSubscriptions = db.prepare(
    `SELECT endpoint, expiration_time, p256dh, auth, device_label
     FROM push_subscriptions
     ORDER BY created_at`,
  );
  const getSubscription = db.prepare(
    `SELECT endpoint, expiration_time, p256dh, auth, device_label
     FROM push_subscriptions
     WHERE endpoint = ?`,
  );
  const upsertSubscription = db.prepare(
    `INSERT INTO push_subscriptions (
       endpoint, expiration_time, p256dh, auth, device_label, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       expiration_time = excluded.expiration_time,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       device_label = excluded.device_label,
       updated_at = excluded.updated_at`,
  );
  const deleteSubscription = db.prepare(
    "DELETE FROM push_subscriptions WHERE endpoint = ?",
  );
  const countSubscriptions = db.prepare(
    "SELECT COUNT(*) AS count FROM push_subscriptions",
  );

  async function publishChanged(): Promise<void> {
    await bb.realtime.publish("attention.changed", {
      count: queue.size,
      changedAt: Date.now(),
    });
  }

  async function reconcile(): Promise<void> {
    const before = queueFingerprint(queue);
    const threads = await bb.sdk.threads.list({
      archived: false,
      includeHidden: false,
      limit: 1_000,
    });
    const next = new Map<string, AttentionItem>();

    for (const thread of threads) {
      if (!isActionable(thread)) continue;
      next.set(thread.id, itemFromThread(thread, queue.get(thread.id)));
    }

    queue.clear();
    for (const [threadId, item] of next) queue.set(threadId, item);
    if (queueFingerprint(queue) !== before) await publishChanged();
  }

  async function sendPushToRow(
    row: PushRow,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          expirationTime: row.expiration_time,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        JSON.stringify(payload),
        {
          vapidDetails: {
            subject: VAPID_SUBJECT,
            publicKey: vapidKeys.publicKey,
            privateKey: vapidKeys.privateKey,
          },
          TTL: 60 * 60,
          urgency: "high",
          timeout: 15_000,
        },
      );
      return { ok: true };
    } catch (error) {
      if (
        error instanceof webpush.WebPushError &&
        (error.statusCode === 404 || error.statusCode === 410)
      ) {
        deleteSubscription.run(row.endpoint);
      }
      const message = error instanceof Error ? error.message : String(error);
      bb.log.warn(`Push delivery failed for ${row.device_label}: ${message}`);
      return { ok: false, message };
    }
  }

  async function sendAttentionPush(item: AttentionItem): Promise<void> {
    const currentSettings = await settings.get();
    if (!currentSettings.notifications) return;

    const copy = notificationCopy(item, currentSettings);
    const rows = listSubscriptions.all() as PushRow[];
    await Promise.allSettled(
      rows.map((row) =>
        sendPushToRow(row, {
          type: "attention",
          threadId: item.threadId,
          title: copy.title,
          body: copy.body,
          sound: currentSettings.sound,
          notifyWhileFocused: currentSettings.notifyWhileFocused,
        }),
      ),
    );
  }

  async function addFromEvent(
    thread: EventThread,
    kind: AttentionItem["kind"],
    summary: string | null,
  ): Promise<void> {
    if (
      thread.visibility !== "visible" ||
      thread.archivedAt !== null ||
      !isUnread(thread)
    ) {
      return;
    }

    const item: AttentionItem = {
      threadId: thread.id,
      projectId: thread.projectId,
      providerId: thread.providerId,
      title: titleFor(thread),
      kind,
      summary: compactSummary(summary),
      attentionAt: thread.latestAttentionAt,
    };
    queue.set(thread.id, item);
    await publishChanged();
    await sendAttentionPush(item);
  }

  bb.events.on("thread.idle", async ({ thread, lastAssistantText }) => {
    await addFromEvent(thread, "completed", lastAssistantText);
  });

  bb.events.on("thread.failed", async ({ thread, error }) => {
    await addFromEvent(thread, "failed", error);
  });

  bb.events.on("thread.active", async ({ thread }) => {
    if (queue.delete(thread.id)) await publishChanged();
  });

  const removeThread = async (threadId: string) => {
    if (queue.delete(threadId)) await publishChanged();
  };
  bb.events.on("thread.archived", ({ thread }) => removeThread(thread.id));
  bb.events.on("thread.deleted", ({ thread }) => removeThread(thread.id));

  bb.background.service("attention-reconcile", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await reconcile();
        } catch (error) {
          bb.log.warn(
            `Attention reconciliation failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        await abortableDelay(RECONCILE_INTERVAL_MS, signal);
      }
    },
  });

  bb.rpc.register(rpcContract, {
    async state() {
      const currentSettings = await settings.get();
      const countRow = countSubscriptions.get() as { count: number };
      return {
        items: sortedItems(queue),
        settings: currentSettings,
        vapidPublicKey: vapidKeys.publicKey,
        pushSubscriptionCount: countRow.count,
      };
    },
    async acknowledge({ threadId }) {
      await bb.sdk.threads.markRead({ threadId });
      if (queue.delete(threadId)) await publishChanged();
      return { ok: true as const };
    },
    async clearAll() {
      let cleared = 0;
      for (const threadId of [...queue.keys()]) {
        try {
          await bb.sdk.threads.markRead({ threadId });
          queue.delete(threadId);
          cleared += 1;
        } catch (error) {
          bb.log.warn(
            `Could not mark ${threadId} read: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      if (cleared > 0) await publishChanged();
      return { cleared };
    },
    registerPush({ subscription, deviceLabel }) {
      const now = Date.now();
      upsertSubscription.run(
        subscription.endpoint,
        subscription.expirationTime ?? null,
        subscription.keys.p256dh,
        subscription.keys.auth,
        deviceLabel,
        now,
        now,
      );
      return { ok: true as const };
    },
    unregisterPush({ endpoint }) {
      deleteSubscription.run(endpoint);
      return { ok: true as const };
    },
    async testPush({ endpoint }) {
      const row = getSubscription.get(endpoint) as PushRow | undefined;
      if (!row) return { ok: false, message: "This device is not registered." };
      const result = await sendPushToRow(row, {
        type: "test",
        title: "BB notifications are ready",
        body: "You’ll be notified when an agent needs your attention.",
        sound: (await settings.get()).sound,
        notifyWhileFocused: true,
      });
      return result.ok
        ? { ok: true, message: "Test notification sent." }
        : { ok: false, message: result.message };
    },
  });

  bb.http.route(
    "GET",
    "/worker.js",
    () =>
      new Response(serviceWorkerSource, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
        },
      }),
    { auth: "local" },
  );

  bb.log.info("Attention notifications loaded");
}
