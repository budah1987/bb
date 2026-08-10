import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createThread, deleteThread } from "../../src/data/threads.js";
import { appendStoredThreadEvent } from "../../src/data/events.js";
import { turnScope } from "@bb/domain";
import {
  countThreadRecapTriggers,
  enableThreadRecap,
  getThreadNotes,
  setThreadRecap,
  setThreadScratchpad,
} from "../../src/data/thread-notes.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "notes-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "notes-project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/notes-project",
    },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread };
}

describe("thread-notes", () => {
  it("reads an untouched thread as empty rather than missing", () => {
    const { db, thread } = setup();

    expect(getThreadNotes(db, thread.id)).toEqual({
      recapBody: null,
      recapEnabled: false,
      recapGeneratedAt: null,
      recapSourceSeq: null,
      scratchpad: "",
      updatedAt: 0,
    });
  });

  it("keeps the scratchpad and the recap independent across writes", () => {
    const { db, thread } = setup();

    setThreadScratchpad(db, { scratchpad: "check the token scope", threadId: thread.id });
    setThreadRecap(db, {
      recapBody: "Provider fix verified; next step is review.",
      recapSourceSeq: 42,
      threadId: thread.id,
    });

    // A recap generation must not clobber what the user typed, and a later
    // scratchpad edit must not invalidate the recap — they are one row but two
    // lifecycles, which is exactly where an over-broad upset `set` would break.
    const afterRecap = getThreadNotes(db, thread.id);
    expect(afterRecap.scratchpad).toBe("check the token scope");
    expect(afterRecap.recapSourceSeq).toBe(42);

    setThreadScratchpad(db, { scratchpad: "rebased", threadId: thread.id });
    const afterEdit = getThreadNotes(db, thread.id);
    expect(afterEdit.scratchpad).toBe("rebased");
    expect(afterEdit.recapBody).toBe(
      "Provider fix verified; next step is review.",
    );
    expect(afterEdit.recapSourceSeq).toBe(42);
  });

  it("enables recap without disturbing existing content and stays idempotent", () => {
    const { db, thread } = setup();
    setThreadScratchpad(db, { scratchpad: "keep me", threadId: thread.id });

    expect(enableThreadRecap(db, thread.id).recapEnabled).toBe(true);
    const second = enableThreadRecap(db, thread.id);
    expect(second.recapEnabled).toBe(true);
    expect(second.scratchpad).toBe("keep me");
  });

  it("counts only what happened after the recap's sequence", () => {
    const { db, thread } = setup();
    const completeTurn = (turnId: string) =>
      appendStoredThreadEvent(db, noopNotifier, {
        threadId: thread.id,
        scope: turnScope(turnId),
        providerThreadId: "provider_thr_1",
        type: "turn/completed",
        data: { providerThreadId: "provider_thr_1", status: "completed" },
      });

    completeTurn("turn_1");
    const recapSeq = completeTurn("turn_2");
    completeTurn("turn_3");
    completeTurn("turn_4");

    // Turns at or before the recap's sequence are already reflected in it —
    // counting them would regenerate a recap that is actually current.
    expect(
      countThreadRecapTriggers(db, { sinceSeq: recapSeq, threadId: thread.id }),
    ).toEqual({ completedTurns: 2, salientEvents: 0 });
    expect(
      countThreadRecapTriggers(db, { sinceSeq: 0, threadId: thread.id }),
    ).toEqual({ completedTurns: 4, salientEvents: 0 });
  });

  it("counts goal transitions as salient", () => {
    const { db, thread } = setup();
    appendStoredThreadEvent(db, noopNotifier, {
      threadId: thread.id,
      scope: turnScope("turn_1"),
      providerThreadId: "provider_thr_1",
      type: "thread/goal/cleared",
      data: { providerThreadId: "provider_thr_1" },
    });

    // A cleared goal is the closest signal the event stream has to "a task
    // finished", and it regenerates the recap without waiting out the cadence.
    expect(
      countThreadRecapTriggers(db, { sinceSeq: 0, threadId: thread.id }),
    ).toEqual({ completedTurns: 0, salientEvents: 1 });
  });

  it("cascades away with its thread", () => {
    const { db, thread } = setup();
    setThreadScratchpad(db, { scratchpad: "transient", threadId: thread.id });

    deleteThread(db, noopNotifier, thread.id);

    expect(getThreadNotes(db, thread.id).scratchpad).toBe("");
  });
});
