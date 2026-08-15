import { describe, expect, it } from "vitest";
import {
  getGithubAccountCatalog,
  getGithubAccountEnvironment,
  getGithubPullRequestCatalog,
  getGithubRepositoryCatalog,
  type GithubCommandRunner,
} from "./github-repositories.js";

describe("GitHub accounts", () => {
  it("lists authenticated accounts without querying repositories", async () => {
    const run: GithubCommandRunner = async (_file, args) => {
      expect(args).toEqual(["auth", "status", "--json", "hosts"]);
      return {
        stdout: JSON.stringify({
          hosts: {
            "github.com": [
              {
                state: "success",
                active: true,
                host: "github.com",
                login: "amirghst",
              },
              {
                state: "success",
                active: false,
                host: "github.com",
                login: "budah1987",
              },
            ],
          },
        }),
        stderr: "",
      };
    };

    await expect(getGithubAccountCatalog({ env: {}, run })).resolves.toEqual({
      accounts: [
        { active: true, host: "github.com", login: "amirghst" },
        { active: false, host: "github.com", login: "budah1987" },
      ],
    });
  });

  it("resolves a selected account to an operation-scoped token", async () => {
    const run: GithubCommandRunner = async (_file, args) => {
      expect(args).toEqual([
        "auth",
        "token",
        "--hostname",
        "github.com",
        "--user",
        "budah1987",
      ]);
      return { stdout: "personal-token\n", stderr: "" };
    };

    await expect(
      getGithubAccountEnvironment({ env: {}, login: "budah1987", run }),
    ).resolves.toEqual({
      GH_HOST: "github.com",
      GH_TOKEN: "personal-token",
    });
  });
});

function repositoryPage(
  repositories: Array<{
    nameWithOwner: string;
    isPrivate?: boolean;
    updatedAt?: string;
  }>,
): string {
  return JSON.stringify([
    {
      data: {
        viewer: {
          repositories: {
            nodes: repositories.map((repository) => {
              const [owner, name] = repository.nameWithOwner.split("/");
              return {
                name,
                nameWithOwner: repository.nameWithOwner,
                owner: { login: owner },
                url: `https://github.com/${repository.nameWithOwner}`,
                isPrivate: repository.isPrivate ?? true,
                defaultBranchRef: { name: "main" },
                updatedAt: repository.updatedAt ?? "2026-08-01T00:00:00.000Z",
              };
            }),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  ]);
}

describe("getGithubRepositoryCatalog", () => {
  it("returns repositories visible to any authenticated account", async () => {
    const calls: Array<{ args: readonly string[]; token: string | undefined }> =
      [];
    const run: GithubCommandRunner = async (_file, args, options) => {
      calls.push({ args, token: options.env.GH_TOKEN });
      if (args[0] === "auth" && args[1] === "status") {
        return {
          stdout: JSON.stringify({
            hosts: {
              "github.com": [
                {
                  state: "success",
                  active: true,
                  host: "github.com",
                  login: "work-user",
                },
                {
                  state: "success",
                  active: false,
                  host: "github.com",
                  login: "personal-user",
                },
              ],
            },
          }),
          stderr: "",
        };
      }
      if (args[0] === "auth" && args[1] === "token") {
        return {
          stdout:
            args.at(-1) === "work-user" ? "work-token\n" : "personal-token\n",
          stderr: "",
        };
      }
      if (args[0] === "api") {
        return {
          stdout:
            options.env.GH_TOKEN === "work-token"
              ? repositoryPage([
                  {
                    nameWithOwner: "shared/console",
                    updatedAt: "2026-08-05T00:00:00.000Z",
                  },
                  { nameWithOwner: "work/private" },
                ])
              : repositoryPage([
                  {
                    nameWithOwner: "shared/console",
                    updatedAt: "2026-08-05T00:00:00.000Z",
                  },
                  { nameWithOwner: "personal/private" },
                ]),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    };

    await expect(
      getGithubRepositoryCatalog({ env: { PATH: "/bin" }, run }),
    ).resolves.toEqual({
      accounts: [
        { host: "github.com", login: "work-user", active: true },
        { host: "github.com", login: "personal-user", active: false },
      ],
      repositories: [
        {
          name: "console",
          nameWithOwner: "shared/console",
          owner: "shared",
          url: "https://github.com/shared/console",
          isPrivate: true,
          defaultBranch: "main",
          updatedAt: "2026-08-05T00:00:00.000Z",
          accessibleBy: ["work-user", "personal-user"],
          activeAccount: "work-user",
        },
        {
          name: "private",
          nameWithOwner: "personal/private",
          owner: "personal",
          url: "https://github.com/personal/private",
          isPrivate: true,
          defaultBranch: "main",
          updatedAt: "2026-08-01T00:00:00.000Z",
          accessibleBy: ["personal-user"],
          activeAccount: null,
        },
        {
          name: "private",
          nameWithOwner: "work/private",
          owner: "work",
          url: "https://github.com/work/private",
          isPrivate: true,
          defaultBranch: "main",
          updatedAt: "2026-08-01T00:00:00.000Z",
          accessibleBy: ["work-user"],
          activeAccount: "work-user",
        },
      ],
      scope: "union",
    });
    expect(calls.filter((call) => call.args[0] === "api")).toEqual([
      expect.objectContaining({ token: "work-token" }),
      expect.objectContaining({ token: "personal-token" }),
    ]);
  });

  it("ignores signed-out accounts and reports a one-account catalog", async () => {
    const run: GithubCommandRunner = async (_file, args, options) => {
      if (args[1] === "status") {
        return {
          stdout: JSON.stringify({
            hosts: {
              "github.com": [
                {
                  state: "success",
                  active: true,
                  host: "github.com",
                  login: "ready-user",
                },
                {
                  state: "failure",
                  active: false,
                  host: "github.com",
                  login: "expired-user",
                },
              ],
            },
          }),
          stderr: "",
        };
      }
      if (args[1] === "token") {
        return { stdout: "ready-token\n", stderr: "" };
      }
      if (args[0] === "api" && options.env.GH_TOKEN === "ready-token") {
        return {
          stdout: repositoryPage([{ nameWithOwner: "ready/project" }]),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    };

    const catalog = await getGithubRepositoryCatalog({ env: {}, run });
    expect(catalog.scope).toBe("account");
    expect(catalog.accounts.map((account) => account.login)).toEqual([
      "ready-user",
    ]);
    expect(catalog.repositories[0]?.accessibleBy).toEqual(["ready-user"]);
  });
});

describe("getGithubPullRequestCatalog", () => {
  it("uses the explicitly selected account environment and parses pull requests", async () => {
    const run: GithubCommandRunner = async (_file, args, options) => {
      if (args[0] === "auth" && args[1] === "status") {
        return {
          stdout: JSON.stringify({
            hosts: {
              "github.com": [
                {
                  state: "success",
                  active: true,
                  host: "github.com",
                  login: "active-user",
                },
                {
                  state: "success",
                  active: false,
                  host: "github.com",
                  login: "selected-user",
                },
              ],
            },
          }),
          stderr: "",
        };
      }
      if (args[0] === "auth" && args[1] === "token") {
        expect(args).toContain("selected-user");
        return { stdout: "selected-token\n", stderr: "" };
      }
      if (args[0] === "pr" && options.env.GH_TOKEN === "selected-token") {
        expect(args).toContain("shared/console");
        expect(options.env.GH_HOST).toBe("github.com");
        return {
          stdout: JSON.stringify([
            {
              number: 17,
              title: "Improve navigation",
              url: "https://github.com/shared/console/pull/17",
              isDraft: false,
              headRefName: "feature/navigation",
              headRepository: { nameWithOwner: "active-user/console" },
              baseRefName: "main",
              author: { login: "active-user" },
              updatedAt: "2026-08-05T00:00:00.000Z",
            },
          ]),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    };

    await expect(
      getGithubPullRequestCatalog({
        env: {
          PATH: "/bin",
          GH_HOST: "ambient.example.com",
          GH_TOKEN: "ambient-token",
        },
        repository: "shared/console",
        githubAccountLogin: "selected-user",
        run,
      }),
    ).resolves.toEqual({
      repository: "shared/console",
      account: "selected-user",
      pullRequests: [
        {
          number: 17,
          title: "Improve navigation",
          url: "https://github.com/shared/console/pull/17",
          isDraft: false,
          headBranch: "feature/navigation",
          headRepository: "active-user/console",
          baseBranch: "main",
          author: "active-user",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      ],
    });
  });

  it("rejects an account that is not authenticated on the host", async () => {
    const run: GithubCommandRunner = async (_file, args) => {
      if (args[0] === "auth" && args[1] === "status") {
        return {
          stdout: JSON.stringify({
            hosts: {
              "github.com": [
                {
                  state: "success",
                  active: true,
                  host: "github.com",
                  login: "active-user",
                },
              ],
            },
          }),
          stderr: "",
        };
      }
      throw new Error(`Unexpected command: ${args.join(" ")}`);
    };

    await expect(
      getGithubPullRequestCatalog({
        env: {},
        repository: "shared/console",
        githubAccountLogin: "missing-user",
        run,
      }),
    ).rejects.toThrow("@missing-user is not authenticated");
  });
});
