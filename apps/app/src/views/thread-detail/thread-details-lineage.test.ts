import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { partitionThreadDetailsLineage } from "./thread-details-lineage";

describe("partitionThreadDetailsLineage", () => {
  it("keeps working and input-waiting children running, newest first", () => {
    const working = makeThreadListEntry({
      id: "working",
      status: "active",
      runtime: { displayStatus: "active" },
      updatedAt: 10,
    });
    const waiting = makeThreadListEntry({
      id: "waiting",
      hasPendingInteraction: true,
      updatedAt: 20,
    });
    const settled = makeThreadListEntry({ id: "settled", updatedAt: 30 });

    const lineage = partitionThreadDetailsLineage([working, settled, waiting]);

    expect(lineage.running.map((child) => child.thread.id)).toEqual([
      "waiting",
      "working",
    ]);
    expect(lineage.previous.map((child) => child.thread.id)).toEqual([
      "settled",
    ]);
  });

  it("counts failed children among previous agents whether read or unread", () => {
    const unreadFailure = makeThreadListEntry({
      id: "unread-failure",
      status: "error",
      latestAttentionAt: 20,
      lastReadAt: 10,
    });
    const readFailure = makeThreadListEntry({
      id: "read-failure",
      status: "error",
      latestAttentionAt: 10,
      lastReadAt: 20,
    });
    const unreadSuccess = makeThreadListEntry({
      id: "unread-success",
      latestAttentionAt: 20,
      lastReadAt: 10,
    });

    const lineage = partitionThreadDetailsLineage([
      unreadFailure,
      readFailure,
      unreadSuccess,
    ]);

    expect(lineage.running).toEqual([]);
    expect(lineage.previous).toHaveLength(3);
    expect(lineage.previousFailedCount).toBe(2);
  });
});
