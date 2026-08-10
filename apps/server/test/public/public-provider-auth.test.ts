import { describe, expect, it } from "vitest";
import type { HostProviderAuthSnapshot } from "@bb/server-contract";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const providerAuthSnapshot = {
  statuses: {
    claudeCode: {
      provider: "claudeCode",
      displayName: "Claude Code",
      state: "loggedOut",
      authMethod: null,
      accountEmail: null,
      organizationName: null,
      message: null,
    },
    codex: {
      provider: "codex",
      displayName: "Codex",
      state: "loggedIn",
      authMethod: "chatgpt",
      accountEmail: "person@example.com",
      organizationName: null,
      message: null,
    },
  },
  sessions: [],
} satisfies HostProviderAuthSnapshot;

describe("public provider authentication", () => {
  it("forwards a Claude one-time code unchanged", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-provider-auth",
      });
      const code = "  exact-code  ";
      const responsePromise = harness.app.request(
        `/api/v1/hosts/${host.id}/provider-auth/submit-code`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: "session-1", code }),
        },
      );
      const command = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "provider_auth.submit_code",
      );
      expect(command.command).toEqual({
        type: "provider_auth.submit_code",
        sessionId: "session-1",
        code,
      });
      await reportQueuedCommandSuccess(harness, command, providerAuthSnapshot);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual(providerAuthSnapshot);
    });
  });
});
