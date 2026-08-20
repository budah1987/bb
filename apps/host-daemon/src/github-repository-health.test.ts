import { describe, expect, it, vi } from "vitest";
import { GithubApiError, type GithubApiClient } from "./github-api.js";
import { getGithubRepositoryHealth } from "./github-repository-health.js";

function clientReturning(value: unknown): GithubApiClient {
  return {
    accounts: vi.fn(),
    token: vi.fn(),
    requestJson: vi.fn(),
    graphql: vi.fn(async () => value),
  };
}

describe("getGithubRepositoryHealth", () => {
  it("batches repositories into one request and returns bounded attention", async () => {
    const client = clientReturning({
      data: {
        repository0: {
          nameWithOwner: "acme/web",
          defaultBranchRef: {
            name: "main",
            target: { statusCheckRollup: { state: "SUCCESS" } },
          },
          pullRequests: {
            totalCount: 2,
            nodes: [
              {
                mergeable: "MERGEABLE",
                reviewDecision: "REVIEW_REQUIRED",
                commits: {
                  nodes: [
                    {
                      commit: { statusCheckRollup: { state: "PENDING" } },
                    },
                  ],
                },
              },
              {
                mergeable: "CONFLICTING",
                reviewDecision: "APPROVED",
                commits: {
                  nodes: [
                    {
                      commit: { statusCheckRollup: { state: "SUCCESS" } },
                    },
                  ],
                },
              },
            ],
          },
        },
        repository1: null,
        rateLimit: { remaining: 42, resetAt: "2026-08-20T00:00:00.000Z" },
      },
    });

    await expect(
      getGithubRepositoryHealth({
        client,
        env: {},
        githubHost: "github.com",
        githubAccountLogin: "amir",
        repositories: ["acme/web", "acme/missing"],
        now: () => new Date("2026-08-19T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      outcome: "available",
      repositories: [
        {
          nameWithOwner: "acme/web",
          defaultBranchCheckState: "passing",
          openPullRequestCount: 2,
          attention: "conflicts",
        },
      ],
      rateLimit: { remaining: 42 },
    });
    expect(client.graphql).toHaveBeenCalledTimes(1);
  });

  it("returns typed authentication and rate-limit outcomes", async () => {
    const authClient = clientReturning(null);
    vi.mocked(authClient.graphql).mockRejectedValue(
      new GithubApiError("bad credentials", 401, null),
    );
    await expect(
      getGithubRepositoryHealth({
        client: authClient,
        env: {},
        githubHost: "github.com",
        githubAccountLogin: "amir",
        repositories: ["acme/web"],
      }),
    ).resolves.toMatchObject({ outcome: "authentication_required" });

    const limitedClient = clientReturning(null);
    vi.mocked(limitedClient.graphql).mockRejectedValue(
      new GithubApiError("limited", 403, "2026-08-20T00:00:00.000Z"),
    );
    await expect(
      getGithubRepositoryHealth({
        client: limitedClient,
        env: {},
        githubHost: "github.com",
        githubAccountLogin: "amir",
        repositories: ["acme/web"],
      }),
    ).resolves.toMatchObject({
      outcome: "rate_limited",
      retryAt: "2026-08-20T00:00:00.000Z",
    });
  });
});
