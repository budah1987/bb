/** Return canonical owner/name for a github.com remote, or null. */
export function parseGithubRepositoryName(
  remoteUrl: string | null,
): string | null {
  if (!remoteUrl) return null;
  const match = remoteUrl
    .trim()
    .match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/u);
  return match ? `${match[1]}/${match[2]}` : null;
}
