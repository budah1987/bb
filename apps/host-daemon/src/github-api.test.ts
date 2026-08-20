import { describe, expect, it, vi } from "vitest";
import {
  createGithubApiClient,
  GithubApiError,
  type GithubCommandRunner,
} from "./github-api.js";

const account = { host: "github.com", login: "selected-user" };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GitHub API client", () => {
  it("reuses a warm account token without spawning another gh process", async () => {
    const run = vi.fn<GithubCommandRunner>(async () => ({
      stdout: "selected-token\n",
      stderr: "",
    }));
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createGithubApiClient({ fetch, run });

    await client.requestJson({ account, env: {}, path: "user" });
    await client.requestJson({ account, env: {}, path: "rate_limit" });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).toEqual([
      "auth",
      "token",
      "--hostname",
      "github.com",
      "--user",
      "selected-user",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("deduplicates identical in-flight API requests", async () => {
    const run = vi.fn<GithubCommandRunner>(async () => ({
      stdout: "selected-token\n",
      stderr: "",
    }));
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return jsonResponse({ ok: true });
    });
    const client = createGithubApiClient({ fetch, run });

    const first = client.requestJson({ account, env: {}, path: "user" });
    const second = client.requestJson({ account, env: {}, path: "user" });
    release?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evicts a rejected token, resolves it once, and retries once", async () => {
    let tokenCall = 0;
    const run = vi.fn<GithubCommandRunner>(async () => ({
      stdout: `${++tokenCall === 1 ? "stale" : "fresh"}-token\n`,
      stderr: "",
    }));
    const authorizations: string[] = [];
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization) authorizations.push(authorization);
      return authorization === "Bearer stale-token"
        ? jsonResponse({ message: "Bad credentials" }, 401)
        : jsonResponse({ login: "selected-user" });
    });
    const client = createGithubApiClient({ fetch, run });

    await expect(
      client.requestJson({ account, env: {}, path: "user" }),
    ).resolves.toEqual({ login: "selected-user" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(authorizations).toEqual([
      "Bearer stale-token",
      "Bearer fresh-token",
    ]);
  });

  it("does not retry indefinitely after a second authentication failure", async () => {
    const run = vi.fn<GithubCommandRunner>(async () => ({
      stdout: "rejected-token\n",
      stderr: "",
    }));
    const fetch = vi.fn(async () =>
      jsonResponse({ message: "Bad credentials" }, 401),
    );
    const client = createGithubApiClient({ fetch, run });

    await expect(
      client.requestJson({ account, env: {}, path: "user" }),
    ).rejects.toMatchObject({ status: 401 } satisfies Partial<GithubApiError>);
    expect(run).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("evicts cached tokens for accounts removed by an auth refresh", async () => {
    let authRefresh = 0;
    let tokenCall = 0;
    const run = vi.fn<GithubCommandRunner>(async (_file, args) => {
      if (args[0] === "auth" && args[1] === "status") {
        authRefresh += 1;
        return {
          stdout: JSON.stringify({
            hosts: {
              "github.com":
                authRefresh === 1
                  ? [
                      {
                        active: true,
                        host: "github.com",
                        login: "selected-user",
                        state: "success",
                      },
                    ]
                  : [],
            },
          }),
          stderr: "",
        };
      }
      tokenCall += 1;
      return { stdout: `token-${tokenCall}\n`, stderr: "" };
    });
    const fetch = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createGithubApiClient({ fetch, run });

    await client.accounts({ env: {}, forceRefresh: true });
    await client.requestJson({ account, env: {}, path: "user" });
    await client.accounts({ env: {}, forceRefresh: true });
    await client.requestJson({ account, env: {}, path: "user" });

    expect(tokenCall).toBe(2);
  });
});
