import { describe, expect, it } from "vitest";
import {
  MAINTAINED_REBUILD_STALE_MS,
  isUpstreamNewer,
  resolveMaintainedRebuild,
  type MaintainedRebuildState,
} from "../src/desktop-maintained-rebuild.js";

const INSTALLED = "0.44.1-bbamir.36895179611.1.3";
const UPSTREAM = "0.45.1-nightly.37496027885.1";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function state(
  overrides: Partial<MaintainedRebuildState>,
): MaintainedRebuildState {
  return {
    schemaVersion: 1,
    status: "building",
    upstreamVersion: UPSTREAM,
    threadId: "thr_rebuild",
    startedAt: "2026-10-07T11:00:00.000Z",
    message: null,
    ...overrides,
  };
}

describe("isUpstreamNewer", () => {
  it("compares the upstream run id with the run id bb+ was built from", () => {
    expect(isUpstreamNewer(INSTALLED, UPSTREAM)).toBe(true);
    expect(isUpstreamNewer(INSTALLED, "0.44.1-nightly.36895179611.2")).toBe(
      false,
    );
    expect(isUpstreamNewer(INSTALLED, "0.44.1-nightly.36184725653.1")).toBe(
      false,
    );
  });

  it("never offers a rebuild for unrecognized versions", () => {
    expect(isUpstreamNewer("0.45.0", UPSTREAM)).toBe(false);
    expect(isUpstreamNewer(INSTALLED, "0.46.0")).toBe(false);
  });
});

describe("resolveMaintainedRebuild", () => {
  it("offers a rebuild only when upstream is newer", () => {
    expect(
      resolveMaintainedRebuild({
        installedVersion: INSTALLED,
        now: NOW,
        state: null,
        upstreamVersion: UPSTREAM,
      }),
    ).toEqual({
      message: null,
      status: "idle",
      threadId: null,
      upstreamVersion: UPSTREAM,
    });
    expect(
      resolveMaintainedRebuild({
        installedVersion: INSTALLED,
        now: NOW,
        state: null,
        upstreamVersion: null,
      }).upstreamVersion,
    ).toBeNull();
  });

  it("keeps showing a running build when the upstream check fails", () => {
    expect(
      resolveMaintainedRebuild({
        installedVersion: INSTALLED,
        now: NOW,
        state: state({}),
        upstreamVersion: null,
      }),
    ).toEqual({
      message: null,
      status: "building",
      threadId: "thr_rebuild",
      upstreamVersion: UPSTREAM,
    });
  });

  it("reports a build with no result after the stale limit as failed", () => {
    const result = resolveMaintainedRebuild({
      installedVersion: INSTALLED,
      now: Date.parse("2026-10-07T11:00:00.000Z") + MAINTAINED_REBUILD_STALE_MS + 1,
      state: state({}),
      upstreamVersion: UPSTREAM,
    });
    expect(result.status).toBe("failed");
    expect(result.threadId).toBe("thr_rebuild");
  });

  it("shows a failed build with its message and newest upstream for retry", () => {
    const newer = "0.45.2-nightly.37600000000.1";
    expect(
      resolveMaintainedRebuild({
        installedVersion: INSTALLED,
        now: NOW,
        state: state({ status: "failed", message: "Patch 0001 conflicts." }),
        upstreamVersion: newer,
      }),
    ).toEqual({
      message: "Patch 0001 conflicts.",
      status: "failed",
      threadId: "thr_rebuild",
      upstreamVersion: newer,
    });
  });

  it("ignores state once the installed build caught up or the build promoted", () => {
    const installedRebuild = "0.45.1-bbamir.37496027885.1.1";
    expect(
      resolveMaintainedRebuild({
        installedVersion: installedRebuild,
        now: NOW,
        state: state({ status: "failed", message: "old" }),
        upstreamVersion: UPSTREAM,
      }),
    ).toEqual({
      message: null,
      status: "idle",
      threadId: null,
      upstreamVersion: null,
    });
  });

  it("does not offer the promoted build again, only a newer upstream", () => {
    const promoted = state({ status: "promoted" });
    expect(
      resolveMaintainedRebuild({
        installedVersion: INSTALLED,
        now: NOW,
        state: promoted,
        upstreamVersion: UPSTREAM,
      }),
    ).toEqual({
      message: null,
      status: "idle",
      threadId: null,
      upstreamVersion: null,
    });
    const newer = "0.45.2-nightly.37600000000.1";
    expect(
      resolveMaintainedRebuild({
        installedVersion: INSTALLED,
        now: NOW,
        state: promoted,
        upstreamVersion: newer,
      }).upstreamVersion,
    ).toBe(newer);
  });
});
