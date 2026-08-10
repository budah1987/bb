import type { EnvironmentDockerService } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  resolveDockerServiceOwnerLabel,
  resolveDockerServiceStatus,
  resolveTerminalServerStatus,
  summarizeLocalServers,
} from "./local-server-status";

function service(
  overrides: Partial<EnvironmentDockerService> = {},
): EnvironmentDockerService {
  return {
    checkoutStatus: "current_checkout",
    id: "svc_1",
    image: "app:dev",
    kind: "server",
    mounts: [
      {
        checkoutRoot: "/worktrees/feature",
        destination: "/app",
        readOnly: false,
        source: "/worktrees/feature",
      },
    ],
    name: "web",
    ownerBranch: null,
    ownerCheckoutRoot: null,
    publishedPorts: [3001],
    state: "running",
    ...overrides,
  };
}

describe("docker service status", () => {
  it("ranks a wrong checkout above every freshness answer", () => {
    for (const freshness of [
      "fresh",
      "stale",
      "missing_build",
      "unknown",
    ] as const) {
      expect(
        resolveDockerServiceStatus({
          freshness,
          service: service({ checkoutStatus: "wrong_checkout" }),
        }),
      ).toMatchObject({
        label: "Wrong checkout",
        severity: "issue",
        tier: "destructive",
      });
    }
  });

  it("reports a shared worker as a fact, never as a failure", () => {
    const shared = resolveDockerServiceStatus({
      freshness: "missing_build",
      service: service({
        checkoutStatus: "declared_shared",
        kind: "shared_worker",
        ownerCheckoutRoot: "/worktrees/main",
        state: "exited",
      }),
    });
    expect(shared).toMatchObject({ label: "Shared", tier: "muted" });
    // A shared worker's build and run state belong to another checkout, so it
    // must not push the section header into an issue count.
    expect(shared.severity).toBe("settled");
    expect(
      summarizeLocalServers({ isLoading: false, statuses: [shared] }),
    ).toEqual({ label: "1 running", tier: "muted" });
  });

  it("only calls a running container fresh once freshness says so", () => {
    expect(
      resolveDockerServiceStatus({ freshness: "fresh", service: service() }),
    ).toMatchObject({ label: "Running :3001", tier: "success" });
    expect(
      resolveDockerServiceStatus({ freshness: "stale", service: service() }),
    ).toMatchObject({ label: "Stale build", severity: "stale" });
    expect(
      resolveDockerServiceStatus({
        freshness: "missing_build",
        service: service(),
      }),
    ).toMatchObject({ label: "No build", severity: "issue" });
    // Not yet asked, and "asked, no answer" read the same: a quiet "Running"
    // that says out loud that freshness is unknown.
    for (const freshness of [null, "unknown"] as const) {
      expect(
        resolveDockerServiceStatus({ freshness, service: service() }),
      ).toMatchObject({
        label: "Running",
        note: "freshness unknown",
        tier: "muted",
      });
    }
  });

  it("does not read a stopped container as merely stale", () => {
    expect(
      resolveDockerServiceStatus({
        freshness: "fresh",
        service: service({ state: "exited" }),
      }),
    ).toMatchObject({ label: "Disconnected", severity: "issue" });
    expect(
      resolveDockerServiceStatus({
        freshness: "fresh",
        service: service({ state: "restarting" }),
      }),
    ).toMatchObject({ label: "Starting", severity: "starting" });
  });

  it("names the owning checkout without rendering an empty line", () => {
    expect(
      resolveDockerServiceOwnerLabel(
        service({ ownerCheckoutRoot: "/worktrees/main" }),
      ),
    ).toBe("/worktrees/main");
    expect(
      resolveDockerServiceOwnerLabel(service({ ownerBranch: "main" })),
    ).toBe("/worktrees/feature");
    expect(
      resolveDockerServiceOwnerLabel(
        service({ mounts: [], ownerBranch: "main" }),
      ),
    ).toBe("main");
    expect(resolveDockerServiceOwnerLabel(service({ mounts: [] }))).toBe(
      "another checkout",
    );
  });
});

describe("local server summary", () => {
  it("reports the worst thing in the list and only that", () => {
    const issue = resolveTerminalServerStatus("wrong_checkout");
    const starting = resolveTerminalServerStatus("starting");
    const stale = resolveDockerServiceStatus({
      freshness: "stale",
      service: service(),
    });
    const running = resolveDockerServiceStatus({
      freshness: "fresh",
      service: service(),
    });

    expect(
      summarizeLocalServers({
        isLoading: false,
        statuses: [issue, stale, starting, running],
      }),
    ).toEqual({ label: "1 issue", tier: "destructive" });
    expect(
      summarizeLocalServers({
        isLoading: false,
        statuses: [stale, starting, running],
      }),
    ).toEqual({ label: "1 stale", tier: "warning" });
    expect(
      summarizeLocalServers({
        isLoading: false,
        statuses: [starting, running],
      }),
    ).toEqual({ label: "1 starting", tier: "warning" });
    expect(summarizeLocalServers({ isLoading: false, statuses: [] })).toEqual({
      label: "None",
      tier: "muted",
    });
    expect(
      summarizeLocalServers({ isLoading: true, statuses: [issue] }),
    ).toEqual({ label: "Loading", tier: "muted" });
  });
});
