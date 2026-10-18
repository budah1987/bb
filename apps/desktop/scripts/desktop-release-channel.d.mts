export type DesktopReleaseChannel = "latest" | "nightly";
export type DesktopBuildPlatform = "macos" | "linux" | "windows";
export type DesktopMaintainedFlavor = "production" | "rehearsal" | null;

export const DESKTOP_MAINTAINED_FLAVOR_ENV_NAME: "BB_DESKTOP_MAINTAINED_FLAVOR";

export type DesktopMaintainedRuntime =
  | { kind: "production"; profileDirectoryName: "bb Nightly" }
  | {
      kind: "rehearsal";
      root: string;
      markerFileName: string;
      dataDir: string;
      profileDir: string;
      serverPort: number;
      daemonPort: number;
    }
  | null;

export interface DesktopUpdateMetadataFileNames {
  linux: "latest-linux.yml" | "nightly-linux.yml";
  macos: "latest-mac.yml" | "nightly-mac.yml";
  windows: "latest.yml" | "nightly.yml";
}

export interface DesktopReleaseConfig {
  appId: string;
  applicationName: string;
  artifactName: string;
  iconFileName: "icon.png" | "icon-nightly.png";
  linuxExecutableName: string;
  macIconPath: "assets/icon.icns" | "assets/icon-nightly.icns";
  packageName: string | null;
  releaseTag: "desktop-latest" | "desktop-nightly";
  runtime: DesktopMaintainedRuntime;
  updateMetadataFileNames: DesktopUpdateMetadataFileNames;
  windowsInstallName: "bb" | "bb-nightly";
  updateReleaseBaseUrl: string;
  updaterCacheDirName: string | null;
}

export function resolveDesktopMaintainedFlavor(
  env: NodeJS.ProcessEnv,
): DesktopMaintainedFlavor;

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function resolveDesktopBuildPlatform(
  nodePlatform: string,
): DesktopBuildPlatform;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
  flavor?: DesktopMaintainedFlavor,
): DesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(
  releaseTag: DesktopReleaseConfig["releaseTag"],
): string;
