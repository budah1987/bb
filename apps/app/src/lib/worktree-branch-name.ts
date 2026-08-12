export const WORKTREE_BRANCH_PREFIXES = [
  { value: "budah1987", label: "Budah1987" },
  { value: "feature", label: "Feature" },
  { value: "fix", label: "Fix" },
  { value: "hotfix", label: "Hotfix" },
  { value: "chore", label: "Chore" },
  { value: "docs", label: "Docs" },
  { value: "refactor", label: "Refactor" },
  { value: "test", label: "Test" },
  { value: "release", label: "Release" },
  { value: "spike", label: "Spike" },
] as const;

export type WorktreeBranchPrefix =
  (typeof WORKTREE_BRANCH_PREFIXES)[number]["value"];

export function formatWorktreeBranchSlug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function buildWorktreeBranchName(
  prefix: WorktreeBranchPrefix,
  slug: string,
): string | null {
  const formattedSlug = formatWorktreeBranchSlug(slug);
  return formattedSlug ? `${prefix}/${formattedSlug}` : null;
}
