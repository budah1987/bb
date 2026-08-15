import type { GithubPullRequestCatalog } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const CATALOG: GithubPullRequestCatalog = {
  repository: "acme/bb",
  account: "work-user",
  pullRequests: [],
};

describe("GET /api/v1/system/github/pull-requests", () => {
  it("forwards the explicitly selected account to the host daemon", async () => {
    await withTestHarness(async (harness) => {
      const primary = seedHostSession(harness.deps, { id: "host-primary" });
      seedPrimaryHost(harness.deps, primary.host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: primary.host.id,
        sessionId: primary.session.id,
        handle: (request) => {
          expect(request.command).toEqual({
            type: "github.pull_request_catalog",
            repository: "acme/bb",
            githubAccountLogin: "work-user",
          });
          return { ok: true, result: CATALOG };
        },
      });

      const response = await harness.app.request(
        "/api/v1/system/github/pull-requests?repository=acme%2Fbb&githubAccountLogin=work-user",
      );

      expect(response.status).toBe(200);
      expect(await readJson(response)).toEqual(CATALOG);
      expect(responder.requests).toHaveLength(1);
    });
  });

  it("rejects omission of the selected account", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/system/github/pull-requests?repository=acme%2Fbb",
      );

      expect(response.status).toBe(400);
    });
  });
});
