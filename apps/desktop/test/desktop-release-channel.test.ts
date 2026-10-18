import { describe, expect, it } from "vitest";
import {
  createDesktopReleaseConfig,
  resolveDesktopMaintainedFlavor,
} from "../scripts/desktop-release-channel.mjs";

describe("desktop release flavors", () => {
  it("defaults to the unchanged upstream release", () => {
    expect(resolveDesktopMaintainedFlavor({})).toBeNull();
    const latest = createDesktopReleaseConfig("latest");
    const nightly = createDesktopReleaseConfig("nightly");
    expect(latest).toMatchObject({
      appId: "dev.bb.desktop",
      applicationName: "bb",
      packageName: null,
      runtime: null,
      updateReleaseBaseUrl: "https://github.com/get-bb/bb/releases/download/desktop-latest/",
      updaterCacheDirName: null,
    });
    expect(nightly).toMatchObject({
      appId: "dev.bb.desktop.nightly",
      applicationName: "bb Nightly",
      packageName: null,
      runtime: null,
      updateMetadataFileNames: { macos: "nightly-mac.yml" },
      updateReleaseBaseUrl: "https://github.com/get-bb/bb/releases/download/desktop-nightly/",
    });
  });

  it("rejects invalid or incompatible flavor selection", () => {
    expect(() => resolveDesktopMaintainedFlavor({ BB_DESKTOP_MAINTAINED_FLAVOR: "other" })).toThrow("must be production or rehearsal");
    expect(() => createDesktopReleaseConfig("latest", "production")).toThrow("requires BB_DESKTOP_RELEASE_CHANNEL=nightly");
  });

  it("keeps production and rehearsal identities, feeds and caches separate", () => {
    const production = createDesktopReleaseConfig("nightly", "production");
    const rehearsal = createDesktopReleaseConfig("nightly", "rehearsal");
    expect(production).toMatchObject({
      appId: "dev.bbamir.desktop.nightly",
      applicationName: "bb+",
      packageName: "bb-maintained-nightly",
      runtime: { kind: "production", profileDirectoryName: "bb Nightly" },
      updateMetadataFileNames: { macos: "nightly-mac.yml" },
      updateReleaseBaseUrl: "http://127.0.0.1:25140/",
      updaterCacheDirName: "bb-maintained-nightly-updater",
    });
    expect(rehearsal).toMatchObject({
      appId: "dev.bbamir.desktop.nightly-rehearsal",
      applicationName: "bb+ Rehearsal",
      packageName: "bb-maintained-nightly-rehearsal",
      runtime: {
        kind: "rehearsal",
        serverPort: 25142,
        daemonPort: 25143,
      },
      updateMetadataFileNames: { macos: "nightly-mac.yml" },
      updateReleaseBaseUrl: "http://127.0.0.1:25141/",
      updaterCacheDirName: "bb-maintained-nightly-rehearsal-updater",
    });
    expect(rehearsal.runtime).not.toEqual(production.runtime);
    expect(rehearsal.updaterCacheDirName).not.toBe(production.updaterCacheDirName);
  });
});
