import type { GithubRepositoryHealthResult } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { invalidateGithubRepositoryHealthCache } from "../../src/services/system/github-repositories.js";

const AVAILABLE: GithubRepositoryHealthResult = {
  outcome: "available",
  host: "github.com",
  login: "work-user",
  repositories: [
    {
      nameWithOwner: "acme/bb",
      defaultBranch: "main",
      defaultBranchCheckState: "passing",
      openPullRequestCount: 1,
      attention: "review_requested",
      fetchedAt: "2026-08-19T12:00:00.000Z",
    },
  ],
  fetchedAt: "2026-08-19T12:00:00.000Z",
  rateLimit: { remaining: 4999, resetAt: null },
};

const PATH =
  "/api/v1/system/github/repository-health?githubAccountLogin=work-user&repositories=acme%2Fbb";

describe("GET /api/v1/system/github/repository-health", () => {
  it("keeps cached navigation reads host-I/O free", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: () => ({ ok: true, result: AVAILABLE }),
      });

      const response = await harness.app.request(`${PATH}&refresh=cached`);

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        outcome: "unavailable",
      });
      expect(responder.requests).toHaveLength(0);
    });
  });

  it("fetches once and serves the warmed result without another host call", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: (request) => {
          expect(request.command).toEqual({
            type: "github.repository_health",
            githubHost: "github.com",
            githubAccountLogin: "work-user",
            repositories: ["acme/bb"],
          });
          return { ok: true, result: AVAILABLE };
        },
      });

      const fetched = await harness.app.request(`${PATH}&refresh=allow-fetch`);
      expect(await readJson(fetched)).toEqual(AVAILABLE);
      const cached = await harness.app.request(`${PATH}&refresh=cached`);
      expect(await readJson(cached)).toEqual(AVAILABLE);
      expect(responder.requests).toHaveLength(1);
    });
  });

  it("evicts a targeted repository after a GitHub mutation", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: () => ({ ok: true, result: AVAILABLE }),
      });

      await harness.app.request(`${PATH}&refresh=allow-fetch`);
      invalidateGithubRepositoryHealthCache(harness.deps, {
        hostId: primary.host.id,
        login: "work-user",
        repository: "acme/bb",
      });
      await harness.app.request(`${PATH}&refresh=allow-fetch`);

      expect(responder.requests).toHaveLength(2);
    });
  });
});
