export type GithubItemKind = "issue" | "pr";

export const DEFAULT_GITHUB_QUERY = "is:open ";

const QUERY_KEYS: Record<GithubItemKind, string> = {
  issue: "bb-plugin-github:query:issue:v1",
  pr: "bb-plugin-github:query:pr:v1",
};

export function readGithubQueries(
  storage: Pick<Storage, "getItem">,
): Record<GithubItemKind, string> {
  return {
    issue: storage.getItem(QUERY_KEYS.issue) ?? DEFAULT_GITHUB_QUERY,
    pr: storage.getItem(QUERY_KEYS.pr) ?? DEFAULT_GITHUB_QUERY,
  };
}

export function writeGithubQuery(
  storage: Pick<Storage, "setItem">,
  kind: GithubItemKind,
  query: string,
): void {
  storage.setItem(QUERY_KEYS[kind], query);
}
