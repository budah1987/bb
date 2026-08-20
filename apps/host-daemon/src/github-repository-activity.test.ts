import { describe, expect, it, vi } from "vitest";
import type { GithubApiClient } from "./github-api.js";
import { getGithubRepositoryActivity } from "./github-repository-activity.js";

describe("getGithubRepositoryActivity", () => {
  it("loads bounded issues, Actions, and repository inbox on demand", async () => {
    const requestJson = vi.fn<GithubApiClient["requestJson"]>(async (args) => {
      if (args.path.includes("/issues?")) {
        return [
          {
            number: 8,
            title: "Fix mobile navigation",
            html_url: "https://github.com/acme/web/issues/8",
            updated_at: "2026-08-19T10:00:00.000Z",
            user: { login: "amir" },
            labels: [{ name: "bug" }],
          },
          { number: 9, pull_request: { url: "api" } },
        ];
      }
      if (args.path.includes("/actions/runs?")) {
        return {
          workflow_runs: [
            {
              id: 99,
              name: "CI",
              html_url: "https://github.com/acme/web/actions/runs/99",
              head_branch: "main",
              event: "push",
              status: "completed",
              conclusion: "failure",
              updated_at: "2026-08-19T11:00:00.000Z",
            },
          ],
        };
      }
      return [
        {
          id: "notification-1",
          repository: { full_name: "acme/web" },
          reason: "review_requested",
          unread: true,
          updated_at: "2026-08-19T11:30:00.000Z",
          subject: {
            title: "Review navigation",
            type: "PullRequest",
            url: "https://api.github.com/repos/acme/web/pulls/17",
          },
        },
      ];
    });
    const client: GithubApiClient = {
      accounts: vi.fn(),
      graphql: vi.fn(),
      token: vi.fn(),
      requestJson,
    };

    await expect(
      getGithubRepositoryActivity({
        client,
        env: {},
        githubHost: "github.com",
        githubAccountLogin: "amir",
        repository: "acme/web",
        now: () => new Date("2026-08-19T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      outcome: "available",
      issues: [{ number: 8, labels: ["bug"] }],
      workflowRuns: [{ id: 99, conclusion: "failure" }],
      inbox: [
        {
          id: "notification-1",
          url: "https://github.com/acme/web/pull/17",
        },
      ],
    });
    expect(requestJson).toHaveBeenCalledTimes(3);
    expect(requestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "repos/acme/web/notifications?all=false&per_page=50",
      }),
    );
  });
});
