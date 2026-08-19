import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDesktopUpdateReleaseBaseUrl,
  DESKTOP_RELEASE_FEED,
} from "../src/release-feed.js";

const desktopRoot = process.cwd();

async function listFilesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith(".release-prebuild-bak-"))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);

        return entry.isDirectory() ? listFilesRecursively(path) : [path];
      }),
  );

  return paths.flat();
}

describe("desktop release feed", () => {
  it("derives the TypeScript and build-script URLs from one JSON source", async () => {
    const scriptFeed: {
      createDesktopUpdateReleaseBaseUrl: (releaseTag: string) => string;
      DESKTOP_RELEASE_FEED: { owner: string; repo: string };
    } = await import(
      pathToFileURL(resolve(desktopRoot, "scripts/release-feed.mjs")).href
    );

    expect(DESKTOP_RELEASE_FEED).toEqual({ owner: "budah1987", repo: "bb" });
    expect(scriptFeed.DESKTOP_RELEASE_FEED).toEqual(DESKTOP_RELEASE_FEED);
    expect(createDesktopUpdateReleaseBaseUrl("desktop-latest")).toBe(
      "https://github.com/budah1987/bb/releases/download/desktop-latest/",
    );
    expect(scriptFeed.createDesktopUpdateReleaseBaseUrl("desktop-latest")).toBe(
      createDesktopUpdateReleaseBaseUrl("desktop-latest"),
    );
  });

  it("does not hardcode the upstream get-bb/bb feed in desktop code", async () => {
    const files = [
      ...(await listFilesRecursively(resolve(desktopRoot, "src"))),
      ...(await listFilesRecursively(resolve(desktopRoot, "scripts"))),
      resolve(desktopRoot, "electron-builder.config.json"),
    ];
    const matches = [];

    for (const file of files) {
      if (/get-bb\/bb/u.test(await readFile(file, "utf8"))) {
        matches.push(file);
      }
    }

    expect(matches).toEqual([]);
  });
});
