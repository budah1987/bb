import { describe, expect, it } from "vitest";
import {
  discoverWorkspaceGithubDeployments,
  parseVercelBranchUrls,
  parseGithubRepository,
  type GithubDeploymentCommandRunner,
} from "./github-deployments.js";

function runner(
  responses: Record<string, string>,
): GithubDeploymentCommandRunner {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    const stdout = responses[key];
    if (stdout === undefined) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return { stdout };
  };
}

describe("parseGithubRepository", () => {
  it.each([
    ["git@github.com:get-bb/bb.git", "get-bb/bb"],
    ["https://github.com/get-bb/bb.git", "get-bb/bb"],
    ["ssh://git@github.com/get-bb/bb.git", "get-bb/bb"],
  ])("parses %s", (remote, expected) => {
    expect(parseGithubRepository(remote)).toBe(expected);
  });

  it("rejects another Git host", () => {
    expect(
      parseGithubRepository("https://example.com/get-bb/bb.git"),
    ).toBeNull();
  });

  it("rejects an SSH remote with an extra path segment", () => {
    expect(
      parseGithubRepository("git@github.com:get-bb/bb/extra.git"),
    ).toBeNull();
  });
});

describe("parseVercelBranchUrls", () => {
  it("reads stable aliases from Vercel's visible project table", () => {
    const urls = parseVercelBranchUrls(`
| Project | Deployment | Actions | Updated (UTC) |
| :--- | :--- | :--- | :--- |
| <a href="https://vercel.com/acme/web"><img /></a> [web](https://vercel.com/acme/web) | [Ready](https://vercel.com/acme/web/deploy) | [Preview](https://web-git-draft-acme.vercel.app) | now |
| [docs](https://vercel.com/acme/docs) | Ready | [Preview](https://docs-git-draft-acme.vercel.app) | now |
    `);

    expect(Object.fromEntries(urls)).toEqual({
      docs: "https://docs-git-draft-acme.vercel.app/",
      web: "https://web-git-draft-acme.vercel.app/",
    });
  });

  it("rejects a Preview link outside Vercel", () => {
    const urls = parseVercelBranchUrls(
      "| [web](https://vercel.com/acme/web) | Ready | [Preview](https://example.com/phish) | now |",
    );

    expect(urls.size).toBe(0);
  });
});

describe("discoverWorkspaceGithubDeployments", () => {
  it("returns raw deployment and latest status facts", async () => {
    const run = runner({
      "git -C /repo rev-parse --abbrev-ref HEAD": "feature/preview\n",
      "git -C /repo remote get-url origin": "git@github.com:get-bb/bb.git\n",
      "gh api --method GET repos/get-bb/bb/deployments -f ref=feature/preview -f per_page=12":
        JSON.stringify([
          {
            id: 42,
            ref: "feature/preview",
            environment: "Preview",
            created_at: "2026-08-09T10:00:00Z",
            updated_at: "2026-08-09T10:01:00Z",
          },
        ]),
      "gh api --method GET repos/get-bb/bb/deployments/42/statuses -f per_page=1":
        JSON.stringify([
          {
            state: "success",
            environment_url: "https://web-commit-get-bb.vercel.app",
            log_url: "https://github.com/get-bb/bb/actions/runs/1",
            created_at: "2026-08-09T10:02:00Z",
            updated_at: "2026-08-09T10:03:00Z",
          },
        ]),
      "gh pr view feature/preview --repo get-bb/bb --json comments":
        JSON.stringify({
          comments: [
            {
              author: { login: "vercel" },
              body: "| [web](https://vercel.com/get-bb/web) | [Ready](https://vercel.com/get-bb/web/deployment) | [Preview](https://web-git-feature-preview-get-bb.vercel.app) | now |",
              createdAt: "2026-08-09T10:04:00Z",
            },
          ],
        }),
    });

    await expect(
      discoverWorkspaceGithubDeployments({
        env: {},
        run,
        workspacePath: "/repo",
      }),
    ).resolves.toEqual({
      outcome: "available",
      repository: "get-bb/bb",
      ref: "feature/preview",
      deployments: [
        {
          id: 42,
          environment: "Preview",
          ref: "feature/preview",
          createdAt: "2026-08-09T10:00:00Z",
          updatedAt: "2026-08-09T10:01:00Z",
          latestStatus: {
            branchUrl: "https://web-git-feature-preview-get-bb.vercel.app/",
            state: "success",
            deploymentUrl: "https://web-commit-get-bb.vercel.app",
            logUrl: "https://github.com/get-bb/bb/actions/runs/1",
            createdAt: "2026-08-09T10:02:00Z",
            updatedAt: "2026-08-09T10:03:00Z",
          },
        },
      ],
    });
  });

  it("keeps the immutable deployment when PR comments are unavailable", async () => {
    const run = runner({
      "git -C /repo rev-parse --abbrev-ref HEAD": "feature/preview\n",
      "git -C /repo remote get-url origin": "git@github.com:get-bb/bb.git\n",
      "gh api --method GET repos/get-bb/bb/deployments -f ref=feature/preview -f per_page=12":
        JSON.stringify([
          {
            id: 42,
            ref: "feature/preview",
            environment: "Preview",
            created_at: "2026-08-09T10:00:00Z",
            updated_at: "2026-08-09T10:01:00Z",
          },
        ]),
      "gh api --method GET repos/get-bb/bb/deployments/42/statuses -f per_page=1":
        JSON.stringify([
          {
            state: "success",
            environment_url: "https://web-commit-get-bb.vercel.app",
            log_url: null,
            created_at: "2026-08-09T10:02:00Z",
            updated_at: "2026-08-09T10:03:00Z",
          },
        ]),
    });

    await expect(
      discoverWorkspaceGithubDeployments({
        env: {},
        run,
        workspacePath: "/repo",
      }),
    ).resolves.toMatchObject({
      outcome: "available",
      deployments: [
        {
          latestStatus: {
            branchUrl: null,
            deploymentUrl: "https://web-commit-get-bb.vercel.app",
          },
        },
      ],
    });
  });

  it("reports a missing GitHub CLI without throwing", async () => {
    const run: GithubDeploymentCommandRunner = async (command, args) => {
      if (command === "git") {
        return {
          stdout: args.includes("--abbrev-ref")
            ? "feature/preview\n"
            : "https://github.com/get-bb/bb.git\n",
        };
      }
      const error = new Error("spawn gh ENOENT");
      Object.assign(error, { code: "ENOENT" });
      throw error;
    };

    await expect(
      discoverWorkspaceGithubDeployments({
        env: {},
        run,
        workspacePath: "/repo",
      }),
    ).resolves.toEqual({
      outcome: "unavailable",
      reason: "github_not_installed",
      message: "GitHub CLI is not installed on this host.",
    });
  });
});
