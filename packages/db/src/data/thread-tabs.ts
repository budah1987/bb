import { eq } from "drizzle-orm";
import type { DbConnection, DbQueryConnection } from "../connection.js";
import { threadTabs } from "../schema.js";

export interface StoredThreadTabs {
  revision: number;
  tabsJson: string;
}

export type ReplaceThreadTabsResult =
  | { outcome: "updated"; revision: number }
  | { outcome: "conflict"; revision: number };

export function getStoredThreadTabs(
  db: DbConnection,
  threadId: string,
): StoredThreadTabs | null {
  return (
    db
      .select({
        revision: threadTabs.revision,
        tabsJson: threadTabs.tabsJson,
      })
      .from(threadTabs)
      .where(eq(threadTabs.threadId, threadId))
      .get() ?? null
  );
}

/**
 * Replace a thread's durable tab list while the caller already owns its write
 * transaction. Archiving leaves a newer empty revision behind so a client with
 * old local tabs reconciles to empty instead of treating this as first use.
 */
export function clearStoredThreadTabs(
  db: DbQueryConnection,
  threadId: string,
): StoredThreadTabs {
  const current = db
    .select({ revision: threadTabs.revision })
    .from(threadTabs)
    .where(eq(threadTabs.threadId, threadId))
    .get();
  const revision = (current?.revision ?? 0) + 1;
  const tabsJson = "[]";
  const updatedAt = Date.now();
  db.insert(threadTabs)
    .values({ revision, tabsJson, threadId, updatedAt })
    .onConflictDoUpdate({
      target: threadTabs.threadId,
      set: { revision, tabsJson, updatedAt },
    })
    .run();
  return { revision, tabsJson };
}

export function replaceStoredThreadTabs(
  db: DbConnection,
  args: {
    expectedRevision: number;
    tabsJson: string;
    threadId: string;
  },
): ReplaceThreadTabsResult {
  return db.transaction((tx) => {
    const current = tx
      .select({ revision: threadTabs.revision })
      .from(threadTabs)
      .where(eq(threadTabs.threadId, args.threadId))
      .get();
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== args.expectedRevision) {
      return { outcome: "conflict", revision: currentRevision };
    }

    const revision = currentRevision + 1;
    const updatedAt = Date.now();
    tx.insert(threadTabs)
      .values({
        revision,
        tabsJson: args.tabsJson,
        threadId: args.threadId,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: threadTabs.threadId,
        set: {
          revision,
          tabsJson: args.tabsJson,
          updatedAt,
        },
      })
      .run();
    return { outcome: "updated", revision };
  });
}
