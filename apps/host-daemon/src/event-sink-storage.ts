import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  hostDaemonEventEnvelopeSchema,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";

export interface StoredEventSinkEntry {
  createdAtMs: number;
  envelope: HostDaemonEventEnvelope;
  id: number;
  sizeBytes: number;
}

export interface EventSinkStorageStats {
  count: number;
  oldestCreatedAtMs: number | null;
  sizeBytes: number;
}

export interface EventSinkStorage {
  append(envelope: HostDaemonEventEnvelope): void;
  close(): void;
  peekBatch(maxEvents: number, maxBytes: number): StoredEventSinkEntry[];
  remove(entries: readonly StoredEventSinkEntry[]): void;
  stats(): EventSinkStorageStats;
}

interface StoredEventSinkRow {
  created_at_ms: number;
  event_id: string;
  event_json: string;
  id: number;
  size_bytes: number;
  thread_id: string;
}

interface StoredEventSinkMetadataRow {
  id: number;
  size_bytes: number;
}

export class MemoryEventSinkStorage implements EventSinkStorage {
  private entries: StoredEventSinkEntry[] = [];
  private nextId = 1;

  append(envelope: HostDaemonEventEnvelope): void {
    const eventJson = JSON.stringify(envelope.event);
    this.entries.push({
      createdAtMs: Date.now(),
      envelope,
      id: this.nextId,
      sizeBytes: Buffer.byteLength(eventJson),
    });
    this.nextId += 1;
  }

  close(): void {
    this.entries = [];
  }

  peekBatch(maxEvents: number, maxBytes: number): StoredEventSinkEntry[] {
    return takeBatch(this.entries, maxEvents, maxBytes);
  }

  remove(entries: readonly StoredEventSinkEntry[]): void {
    if (entries.length === 0) return;
    const removedIds = new Set(entries.map((entry) => entry.id));
    this.entries = this.entries.filter((entry) => !removedIds.has(entry.id));
  }

  stats(): EventSinkStorageStats {
    return {
      count: this.entries.length,
      oldestCreatedAtMs: this.entries[0]?.createdAtMs ?? null,
      sizeBytes: this.entries.reduce(
        (total, entry) => total + entry.sizeBytes,
        0,
      ),
    };
  }
}

export class SqliteEventSinkStorage implements EventSinkStorage {
  private readonly database: Database.Database;
  private readonly deleteEntry: Database.Statement<[number]>;
  private readonly insertEntry: Database.Statement<
    [string, string, string, number, number]
  >;
  private readonly listEntries: Database.Statement<[number, number]>;
  private readonly listEntryMetadata: Database.Statement<[number]>;
  private readonly removeEntries: (
    entries: readonly StoredEventSinkEntry[],
  ) => void;
  private storageStats: EventSinkStorageStats;

  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = NORMAL");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS event_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        thread_id TEXT NOT NULL,
        event_json TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      )
    `);
    const columns = this.database
      .prepare("PRAGMA table_info(event_outbox)")
      .all() as { name: string }[];
    if (!columns.some((column) => column.name === "event_id")) {
      this.database.exec("ALTER TABLE event_outbox ADD COLUMN event_id TEXT");
      const rows = this.database
        .prepare("SELECT id FROM event_outbox ORDER BY id")
        .all() as { id: number }[];
      const setEventId = this.database.prepare(
        "UPDATE event_outbox SET event_id = ? WHERE id = ?",
      );
      this.database.transaction(() => {
        for (const row of rows) setEventId.run(randomUUID(), row.id);
      })();
    }
    this.database.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS event_outbox_event_id_idx ON event_outbox(event_id)",
    );
    this.insertEntry = this.database.prepare(
      `INSERT INTO event_outbox
        (event_id, thread_id, event_json, size_bytes, created_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
    );
    this.listEntryMetadata = this.database.prepare(
      `SELECT id, size_bytes
       FROM event_outbox
       ORDER BY id
       LIMIT ?`,
    );
    this.listEntries = this.database.prepare(
      `SELECT id, event_id, thread_id, event_json, size_bytes, created_at_ms
       FROM event_outbox
       WHERE id <= ?
       ORDER BY id
       LIMIT ?`,
    );
    this.deleteEntry = this.database.prepare(
      "DELETE FROM event_outbox WHERE id = ?",
    );
    this.removeEntries = this.database.transaction(
      (entries: readonly StoredEventSinkEntry[]) => {
        for (const entry of entries) this.deleteEntry.run(entry.id);
      },
    );
    const stats = this.database
      .prepare(
        `SELECT
          COUNT(*) AS count,
          MIN(created_at_ms) AS oldest_created_at_ms,
          COALESCE(SUM(size_bytes), 0) AS size_bytes
         FROM event_outbox`,
      )
      .get() as {
      count: number;
      oldest_created_at_ms: number | null;
      size_bytes: number;
    };
    this.storageStats = {
      count: stats.count,
      oldestCreatedAtMs: stats.oldest_created_at_ms,
      sizeBytes: stats.size_bytes,
    };
  }

  append(envelope: HostDaemonEventEnvelope): void {
    const eventJson = JSON.stringify(envelope.event);
    const sizeBytes = Buffer.byteLength(eventJson);
    const createdAtMs = Date.now();
    this.insertEntry.run(
      envelope.eventId,
      envelope.threadId,
      eventJson,
      sizeBytes,
      createdAtMs,
    );
    this.storageStats.count += 1;
    this.storageStats.sizeBytes += sizeBytes;
    this.storageStats.oldestCreatedAtMs ??= createdAtMs;
  }

  close(): void {
    this.database.close();
  }

  peekBatch(maxEvents: number, maxBytes: number): StoredEventSinkEntry[] {
    const metadataRows = this.listEntryMetadata.all(
      maxEvents,
    ) as StoredEventSinkMetadataRow[];
    let selectedCount = 0;
    let selectedBytes = 0;
    for (const row of metadataRows) {
      if (selectedCount > 0 && selectedBytes + row.size_bytes > maxBytes) break;
      selectedCount += 1;
      selectedBytes += row.size_bytes;
    }
    const lastSelectedId = metadataRows[selectedCount - 1]?.id;
    if (lastSelectedId === undefined) return [];

    const rows = this.listEntries.all(
      lastSelectedId,
      selectedCount,
    ) as StoredEventSinkRow[];
    return rows.map((row) => ({
      createdAtMs: row.created_at_ms,
      envelope: hostDaemonEventEnvelopeSchema.parse({
        eventId: row.event_id,
        threadId: row.thread_id,
        event: JSON.parse(row.event_json),
      }),
      id: row.id,
      sizeBytes: row.size_bytes,
    }));
  }

  remove(entries: readonly StoredEventSinkEntry[]): void {
    if (entries.length === 0) return;
    this.removeEntries(entries);
    this.storageStats.count -= entries.length;
    this.storageStats.sizeBytes -= entries.reduce(
      (total, entry) => total + entry.sizeBytes,
      0,
    );
    if (this.storageStats.count === 0) {
      this.storageStats.oldestCreatedAtMs = null;
      this.storageStats.sizeBytes = 0;
      return;
    }
    if (entries[0]?.createdAtMs === this.storageStats.oldestCreatedAtMs) {
      const oldest = this.database
        .prepare("SELECT MIN(created_at_ms) AS value FROM event_outbox")
        .get() as { value: number | null };
      this.storageStats.oldestCreatedAtMs = oldest.value;
    }
  }

  stats(): EventSinkStorageStats {
    return { ...this.storageStats };
  }
}

function takeBatch(
  entries: readonly StoredEventSinkEntry[],
  maxEvents: number,
  maxBytes: number,
): StoredEventSinkEntry[] {
  const batch: StoredEventSinkEntry[] = [];
  let sizeBytes = 0;
  for (const entry of entries) {
    if (batch.length >= maxEvents) break;
    if (batch.length > 0 && sizeBytes + entry.sizeBytes > maxBytes) break;
    batch.push(entry);
    sizeBytes += entry.sizeBytes;
  }
  return batch;
}
