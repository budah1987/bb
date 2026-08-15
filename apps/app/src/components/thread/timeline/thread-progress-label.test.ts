import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { resolveThreadProgressLabel } from "./thread-progress-label.js";

function userRequest(status: "pending" | "accepted"): TimelineRow {
  return {
    id: `request-${status}`,
    threadId: "thread-1",
    turnId: null,
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: "conversation",
    role: "user",
    text: "Request",
    attachments: null,
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    turnRequest: { kind: "message", status, isGrouped: false },
    mentions: [],
  };
}

function label(
  args: Partial<Parameters<typeof resolveThreadProgressLabel>[0]>,
) {
  return resolveThreadProgressLabel({
    activeThinking: false,
    displayStatus: "active",
    isTurnSubmitting: false,
    rows: [],
    ...args,
  });
}

describe("resolveThreadProgressLabel", () => {
  it("shows each request stage", () => {
    expect(label({ isTurnSubmitting: true })).toBe("Waiting in BB...");
    expect(label({ displayStatus: "starting" })).toBe("Starting provider...");
    expect(label({ rows: [userRequest("pending")] })).toBe(
      "Waiting for provider...",
    );
    expect(label({ rows: [userRequest("accepted")] })).toBe("Reasoning...");
  });

  it("keeps live reasoning details visible", () => {
    expect(
      label({ activeThinking: true, rows: [userRequest("accepted")] }),
    ).toBeUndefined();
  });
});
