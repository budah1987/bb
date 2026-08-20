import type { GithubRepositoryActivityResult } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const ACTIVITY: GithubRepositoryActivityResult = {
  outcome: "available",
  host: "github.com",
  login: "work-user",
  repository: "acme/bb",
  issues: [],
  workflowRuns: [],
  inbox: [],
  fetchedAt: "2026-08-19T12:00:00.000Z",
};

describe("GET /api/v1/system/github/repository-activity", () => {
  it("routes the on-demand read to the explicitly selected host account", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: (request) => {
          expect(request.command).toEqual({
            type: "github.repository_activity",
            githubHost: "github.com",
            githubAccountLogin: "work-user",
            repository: "acme/bb",
          });
          return { ok: true, result: ACTIVITY };
        },
      });

      const response = await harness.app.request(
        "/api/v1/system/github/repository-activity?githubAccountLogin=work-user&repository=acme%2Fbb",
      );
      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(ACTIVITY);
      expect(responder.requests).toHaveLength(1);
    });
  });
});
