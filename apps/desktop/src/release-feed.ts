import releaseFeed from "../release-feed.json";

export interface DesktopReleaseFeedConfig {
  owner: string;
  repo: string;
}

export const DESKTOP_RELEASE_FEED: DesktopReleaseFeedConfig = releaseFeed;

export function createDesktopUpdateReleaseBaseUrl(releaseTag: string): string {
  const { owner, repo } = DESKTOP_RELEASE_FEED;

  return `https://github.com/${owner}/${repo}/releases/download/${releaseTag}/`;
}
