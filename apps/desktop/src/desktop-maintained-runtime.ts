import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { DesktopReleaseConfig } from "../scripts/desktop-release-channel.mjs";

interface DesktopStartupPolicyArgs {
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  homeDir: string;
  platform: NodeJS.Platform;
  release: DesktopReleaseConfig;
}

export interface DesktopStartupPolicy {
  environment: Record<string, string>;
  userDataPath: string | null;
}

function readUserDataArgument(argv: readonly string[]): string | null {
  let path: string | null = null;
  for (const argument of argv) {
    if (argument === "--user-data-dir" || argument.startsWith("-user-data-dir")) {
      throw new Error("Use --user-data-dir=<path> with a nonempty path.");
    }
    if (!argument.startsWith("--user-data-dir=")) {
      continue;
    }
    if (path !== null) {
      throw new Error("Duplicate --user-data-dir arguments are not allowed.");
    }
    const value = argument.slice("--user-data-dir=".length);
    if (value.trim().length === 0) {
      throw new Error("--user-data-dir requires a nonempty path.");
    }
    path = value;
  }
  return path;
}

function assertOwnedDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || realpathSync(path) !== path || stat.uid !== process.getuid?.()) {
    throw new Error(`Rehearsal directory is not owned and isolated: ${path}`);
  }
}

function assertRehearsalMarker(runtime: Extract<NonNullable<DesktopReleaseConfig["runtime"]>, { kind: "rehearsal" }>): void {
  assertOwnedDirectory(runtime.root);
  assertOwnedDirectory(runtime.dataDir);
  assertOwnedDirectory(runtime.profileDir);
  const markerPath = join(runtime.root, runtime.markerFileName);
  const marker = lstatSync(markerPath);
  if (!marker.isFile() || marker.uid !== process.getuid?.()) {
    throw new Error("Rehearsal marker must be an owned regular file.");
  }
  if (readFileSync(markerPath, "utf8") !== "bb-maintained-nightly-rehearsal-v1\n") {
    throw new Error("Rehearsal marker does not match this build.");
  }
}

function assertRehearsalEnvironment(
  env: NodeJS.ProcessEnv,
  expected: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(expected)) {
    const supplied = env[key]?.trim();
    if (supplied !== undefined && supplied.length > 0 && supplied !== value) {
      throw new Error(`${key} conflicts with the rehearsal build.`);
    }
  }
  for (const key of [
    "BB_APP_URL",
    "BB_SERVER_URL",
    "BB_DESKTOP_APP_URL",
    "BB_DESKTOP_VERSION_FEED_URL",
  ]) {
    if ((env[key]?.trim().length ?? 0) > 0) {
      throw new Error(`${key} is not allowed in the rehearsal build.`);
    }
  }
}

export function createDesktopStartupPolicy(
  args: DesktopStartupPolicyArgs,
): DesktopStartupPolicy {
  const runtime = args.release.runtime;
  if (runtime === null) {
    return { environment: {}, userDataPath: null };
  }
  if (args.platform !== "darwin") {
    throw new Error("Maintained Nightly currently supports macOS only.");
  }
  const explicitUserDataPath = readUserDataArgument(args.argv);
  if (runtime.kind === "production") {
    return {
      environment: {},
      userDataPath:
        explicitUserDataPath === null
          ? join(
              args.homeDir,
              "Library",
              "Application Support",
              runtime.profileDirectoryName,
            )
          : null,
    };
  }

  assertRehearsalMarker(runtime);
  if (
    explicitUserDataPath !== null &&
    explicitUserDataPath !== runtime.profileDir
  ) {
    throw new Error("--user-data-dir conflicts with the rehearsal profile.");
  }
  const environment = {
    BB_DATA_DIR: runtime.dataDir,
    BB_SERVER_PORT: String(runtime.serverPort),
    BB_HOST_DAEMON_PORT: String(runtime.daemonPort),
    BB_SERVER_BIND_HOST: "127.0.0.1",
  };
  assertRehearsalEnvironment(args.env, environment);
  return { environment, userDataPath: runtime.profileDir };
}
