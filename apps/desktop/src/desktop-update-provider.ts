import {
  createBbDesktopVersionFeedFileName,
  type BbDesktopVersionFeedPlatform,
} from "@bb/desktop-contract";
import {
  createDesktopReleaseConfig,
  resolveDesktopMaintainedFlavor,
  resolveDesktopReleaseChannel,
  type DesktopMaintainedFlavor,
  type DesktopReleaseChannel,
  type DesktopReleaseConfig,
} from "../scripts/desktop-release-channel.mjs";

export type DesktopReleaseInfo = DesktopReleaseConfig;

export function createDesktopReleaseInfo(
  channel: DesktopReleaseChannel,
  flavor: DesktopMaintainedFlavor = null,
): DesktopReleaseInfo {
  return createDesktopReleaseConfig(channel, flavor);
}

export const DESKTOP_RELEASE_CHANNEL = resolveDesktopReleaseChannel({
  BB_DESKTOP_RELEASE_CHANNEL: process.env.BB_DESKTOP_RELEASE_CHANNEL,
});
export const DESKTOP_MAINTAINED_FLAVOR = resolveDesktopMaintainedFlavor({
  BB_DESKTOP_MAINTAINED_FLAVOR: process.env.BB_DESKTOP_MAINTAINED_FLAVOR,
});
export const DESKTOP_RELEASE_INFO = createDesktopReleaseInfo(
  DESKTOP_RELEASE_CHANNEL,
  DESKTOP_MAINTAINED_FLAVOR,
);
const DESKTOP_UPDATE_RELEASE_BASE_URL =
  DESKTOP_RELEASE_INFO.updateReleaseBaseUrl;

export function createDesktopUpdateFeedUrl(
  platform: BbDesktopVersionFeedPlatform,
): string {
  return `${DESKTOP_UPDATE_RELEASE_BASE_URL}${createBbDesktopVersionFeedFileName(platform)}`;
}

export interface DesktopAutoUpdateFeedConfig {
  channel: DesktopReleaseChannel;
  provider: "generic";
  url: string;
  useMultipleRangeRequest?: false;
}

export function createDesktopAutoUpdateFeedConfig(
  channel: DesktopReleaseChannel,
  release: DesktopReleaseInfo,
): DesktopAutoUpdateFeedConfig {
  return {
    channel,
    provider: "generic",
    url: release.updateReleaseBaseUrl,
    ...(release.runtime === null ? {} : { useMultipleRangeRequest: false as const }),
  };
}

export const DESKTOP_AUTO_UPDATE_FEED_CONFIG = createDesktopAutoUpdateFeedConfig(
  DESKTOP_RELEASE_CHANNEL,
  DESKTOP_RELEASE_INFO,
);

interface DesktopUpdateSupport {
  autoUpdate: boolean;
  versionCheck: boolean;
}

interface ResolveDesktopUpdateSupportArgs {
  canReplaceAppImage: (appImagePath: string) => boolean;
  env: NodeJS.ProcessEnv;
  platform: BbDesktopVersionFeedPlatform;
}

export function resolveDesktopUpdateSupport(
  args: ResolveDesktopUpdateSupportArgs,
): DesktopUpdateSupport {
  if (args.platform === "macos" || args.platform === "windows") {
    return { autoUpdate: true, versionCheck: true };
  }

  const appImagePath = args.env.APPIMAGE?.trim() ?? "";
  if (appImagePath.length === 0) {
    return { autoUpdate: false, versionCheck: true };
  }

  return {
    autoUpdate: args.canReplaceAppImage(appImagePath),
    versionCheck: true,
  };
}
