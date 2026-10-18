import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopReleaseConfig } from "../scripts/desktop-release-channel.mjs";
import { createDesktopStartupPolicy } from "../src/desktop-maintained-runtime.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createRehearsalFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bb-maintained-rehearsal-")));
  temporaryRoots.push(root);
  const release = createDesktopReleaseConfig("nightly", "rehearsal");
  if (release.runtime?.kind !== "rehearsal") {
    throw new Error("Expected rehearsal runtime");
  }
  const runtime = {
    ...release.runtime,
    root,
    dataDir: join(root, "data"),
    profileDir: join(root, "profile"),
  };
  mkdirSync(runtime.dataDir);
  mkdirSync(runtime.profileDir);
  writeFileSync(join(root, runtime.markerFileName), "bb-maintained-nightly-rehearsal-v1\n");
  return { ...release, runtime };
}

describe("maintained desktop startup policy", () => {
  it("uses the existing Nightly profile unless a user-data-dir is explicit", () => {
    const release = createDesktopReleaseConfig("nightly", "production");
    const args = {
      argv: ["bb+"],
      env: {},
      homeDir: "/Users/example",
      platform: "darwin" as const,
      release,
    };
    expect(createDesktopStartupPolicy(args)).toEqual({
      environment: {},
      userDataPath: "/Users/example/Library/Application Support/bb Nightly",
    });
    expect(createDesktopStartupPolicy({ ...args, argv: ["bb", "--user-data-dir=/tmp/isolated"] })).toEqual({
      environment: {},
      userDataPath: null,
    });
    for (const argv of [
      ["bb", "--user-data-dir", "/tmp/isolated"],
      ["bb", "--user-data-dir", "--other-flag"],
      ["bb", "-user-data-dir=/tmp/isolated"],
      ["bb", "--user-data-dir="],
    ]) {
      expect(() => createDesktopStartupPolicy({ ...args, argv })).toThrow("nonempty path");
    }
    expect(() => createDesktopStartupPolicy({ ...args, argv: ["bb", "--user-data-dir"] })).toThrow("nonempty path");
    expect(() => createDesktopStartupPolicy({ ...args, argv: ["bb", "--user-data-dir=a", "--user-data-dir=b"] })).toThrow("Duplicate");
  });

  it("pins rehearsal data, profile and ports across a bare relaunch", () => {
    const release = createRehearsalFixture();
    const args = {
      argv: ["bb+ Rehearsal"],
      env: {},
      homeDir: "/Users/example",
      platform: "darwin" as const,
      release,
    };
    expect(createDesktopStartupPolicy(args)).toEqual({
      environment: {
        BB_DATA_DIR: release.runtime.dataDir,
        BB_SERVER_PORT: "25142",
        BB_HOST_DAEMON_PORT: "25143",
        BB_SERVER_BIND_HOST: "127.0.0.1",
      },
      userDataPath: release.runtime.profileDir,
    });
    expect(() => createDesktopStartupPolicy({ ...args, env: { BB_DATA_DIR: "/Users/example/.bb" } })).toThrow("conflicts");
    expect(() => createDesktopStartupPolicy({ ...args, env: { BB_DESKTOP_VERSION_FEED_URL: "https://example.com" } })).toThrow("not allowed");
    expect(() => createDesktopStartupPolicy({ ...args, argv: ["bb", "--user-data-dir=/tmp/wrong"] })).toThrow("conflicts");
  });

  it("refuses a missing or wrong rehearsal marker before startup", () => {
    const release = createRehearsalFixture();
    const args = {
      argv: ["bb"],
      env: {},
      homeDir: "/Users/example",
      platform: "darwin" as const,
      release,
    };
    writeFileSync(join(release.runtime.root, release.runtime.markerFileName), "wrong\n");
    expect(() => createDesktopStartupPolicy(args)).toThrow("marker does not match");
    rmSync(join(release.runtime.root, release.runtime.markerFileName));
    expect(() => createDesktopStartupPolicy(args)).toThrow();
  });
});
