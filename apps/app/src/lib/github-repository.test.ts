import { describe, expect, it } from "vitest";
import { parseGithubRepositoryName } from "./github-repository";

describe("parseGithubRepositoryName", () => {
  it.each([
    ["git@github.com:ghosts-inc/ghost.git", "ghosts-inc/ghost"],
    ["https://github.com/amirghst/ghost-vault.git", "amirghst/ghost-vault"],
    ["ssh://git@github.com/get-bb/bb", "get-bb/bb"],
  ])("parses %s", (remote, expected) => {
    expect(parseGithubRepositoryName(remote)).toBe(expected);
  });

  it("rejects local and non-GitHub remotes", () => {
    expect(parseGithubRepositoryName("/Users/me/repo")).toBeNull();
    expect(
      parseGithubRepositoryName("git@gitlab.com:owner/repo.git"),
    ).toBeNull();
    expect(parseGithubRepositoryName(null)).toBeNull();
  });
});
