import { describe, expect, it } from "vitest";
import { getThreadReadToggleAction } from "./threadReadState";

describe("getThreadReadToggleAction", () => {
  it("marks a thread read when it has never been read", () => {
    expect(
      getThreadReadToggleAction({
        lastReadAt: null,
        latestAttentionAt: 10,
      }),
    ).toBe("mark_read");
  });

  it("marks a thread read when its last read timestamp trails the latest attention", () => {
    expect(
      getThreadReadToggleAction({
        lastReadAt: 4,
        latestAttentionAt: 10,
      }),
    ).toBe("mark_read");
  });

  it("marks an explicitly handled thread unread", () => {
    expect(
      getThreadReadToggleAction({
        lastReadAt: 10,
        latestAttentionAt: 10,
      }),
    ).toBe("mark_unread");
  });

  it("marks a viewed thread read to clear its awaiting reply state", () => {
    expect(
      getThreadReadToggleAction({
        lastReadAt: 11,
        latestAttentionAt: 10,
      }),
    ).toBe("mark_read");
  });
});
