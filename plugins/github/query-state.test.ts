import { describe, expect, it } from "vitest";
import {
  DEFAULT_GITHUB_QUERY,
  readGithubQueries,
  writeGithubQuery,
} from "./query-state";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("GitHub panel query state", () => {
  it("keeps issue and pull request filters independent", () => {
    const storage = memoryStorage();

    writeGithubQuery(storage, "issue", "repo:budah1987/bb is:closed ");

    expect(readGithubQueries(storage)).toEqual({
      issue: "repo:budah1987/bb is:closed ",
      pr: DEFAULT_GITHUB_QUERY,
    });
  });

  it("does not carry the legacy shared filter into either tab", () => {
    const storage = memoryStorage({
      "bb-plugin-github:query": "repo:budah1987/bb is:closed ",
    });

    expect(readGithubQueries(storage)).toEqual({
      issue: DEFAULT_GITHUB_QUERY,
      pr: DEFAULT_GITHUB_QUERY,
    });
  });
});
