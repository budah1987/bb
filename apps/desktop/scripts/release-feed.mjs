import { readFileSync } from "node:fs";

export const DESKTOP_RELEASE_FEED = JSON.parse(
  readFileSync(new URL("../release-feed.json", import.meta.url), "utf8"),
);

export function createDesktopUpdateReleaseBaseUrl(releaseTag) {
  const { owner, repo } = DESKTOP_RELEASE_FEED;

  return `https://github.com/${owner}/${repo}/releases/download/${releaseTag}/`;
}
