const DESKTOP_RELEASE_CHANNEL_ENV_NAME = "BB_DESKTOP_RELEASE_CHANNEL";
export const DESKTOP_MAINTAINED_FLAVOR_ENV_NAME =
  "BB_DESKTOP_MAINTAINED_FLAVOR";

const REHEARSAL_ROOT =
  "/Users/amir/.local/share/bb-maintained-nightly/rehearsal";

export function resolveDesktopMaintainedFlavor(env) {
  const rawFlavor = env[DESKTOP_MAINTAINED_FLAVOR_ENV_NAME]?.trim();
  if (rawFlavor === undefined || rawFlavor.length === 0) {
    return null;
  }
  if (rawFlavor === "production" || rawFlavor === "rehearsal") {
    return rawFlavor;
  }
  throw new Error(
    `${DESKTOP_MAINTAINED_FLAVOR_ENV_NAME} must be production or rehearsal, got ${rawFlavor}.`,
  );
}

export function resolveDesktopReleaseChannel(env) {
  const rawChannel = env[DESKTOP_RELEASE_CHANNEL_ENV_NAME]?.trim();
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (rawChannel === "latest" || rawChannel === "nightly") {
    return rawChannel;
  }

  throw new Error(
    `${DESKTOP_RELEASE_CHANNEL_ENV_NAME} must be latest or nightly, got ${rawChannel}.`,
  );
}

export function resolveDesktopBuildPlatform(nodePlatform) {
  if (nodePlatform === "darwin") {
    return "macos";
  }
  if (nodePlatform === "linux") {
    return "linux";
  }
  if (nodePlatform === "win32") {
    return "windows";
  }

  throw new Error(
    `Desktop builds support darwin, linux, and win32 only, got ${nodePlatform}.`,
  );
}

export function createDesktopReleaseConfig(channel, flavor = null) {
  if (flavor !== null) {
    if (channel !== "nightly") {
      throw new Error(
        `${DESKTOP_MAINTAINED_FLAVOR_ENV_NAME} requires BB_DESKTOP_RELEASE_CHANNEL=nightly.`,
      );
    }
    if (flavor !== "production" && flavor !== "rehearsal") {
      throw new Error(`Unsupported maintained desktop flavor: ${flavor}.`);
    }

    const isProduction = flavor === "production";
    const packageName = isProduction
      ? "bb-maintained-nightly"
      : "bb-maintained-nightly-rehearsal";
    return {
      appId: isProduction
        ? "dev.bbamir.desktop.nightly"
        : "dev.bbamir.desktop.nightly-rehearsal",
      applicationName: isProduction
        ? "bb+"
        : "bb+ Rehearsal",
      artifactName: `${packageName}-\${version}-\${arch}.\${ext}`,
      iconFileName: "icon-nightly.png",
      linuxExecutableName: packageName,
      macIconPath: "assets/icon-nightly.icns",
      packageName,
      releaseTag: "desktop-nightly",
      windowsInstallName: "bb-nightly",
      runtime: isProduction
        ? { kind: "production", profileDirectoryName: "bb Nightly" }
        : {
            kind: "rehearsal",
            root: REHEARSAL_ROOT,
            markerFileName: ".rehearsal-marker",
            dataDir: `${REHEARSAL_ROOT}/data`,
            profileDir: `${REHEARSAL_ROOT}/profile`,
            serverPort: 25142,
            daemonPort: 25143,
          },
      updateMetadataFileNames: {
        linux: "nightly-linux.yml",
        macos: "nightly-mac.yml",
        windows: "nightly.yml",
      },
      updateReleaseBaseUrl: isProduction
        ? "http://127.0.0.1:25140/"
        : "http://127.0.0.1:25141/",
      updaterCacheDirName: `${packageName}-updater`,
    };
  }
  if (channel === "nightly") {
    return {
      appId: "dev.bb.desktop.nightly",
      applicationName: "bb Nightly",
      artifactName: "bb-nightly-${version}-${arch}.${ext}",
      iconFileName: "icon-nightly.png",
      // The Linux binary name must differ from stable so both channels can be
      // installed at once without one shadowing the other on PATH.
      linuxExecutableName: "bb-nightly",
      macIconPath: "assets/icon-nightly.icns",
      packageName: null,
      releaseTag: "desktop-nightly",
      windowsInstallName: "bb-nightly",
      runtime: null,
      updateMetadataFileNames: {
        linux: "nightly-linux.yml",
        macos: "nightly-mac.yml",
        windows: "nightly.yml",
      },
      updateReleaseBaseUrl: createDesktopUpdateReleaseBaseUrl("desktop-nightly"),
      updaterCacheDirName: null,
    };
  }

  return {
    appId: "dev.bb.desktop",
    applicationName: "bb",
    artifactName: "${productName}-${version}-${arch}.${ext}",
    iconFileName: "icon.png",
    linuxExecutableName: "bb",
    macIconPath: "assets/icon.icns",
    packageName: null,
    releaseTag: "desktop-latest",
    windowsInstallName: "bb",
    runtime: null,
    updateMetadataFileNames: {
      linux: "latest-linux.yml",
      macos: "latest-mac.yml",
      windows: "latest.yml",
    },
    updateReleaseBaseUrl: createDesktopUpdateReleaseBaseUrl("desktop-latest"),
    updaterCacheDirName: null,
  };
}

export function createDesktopUpdateReleaseBaseUrl(releaseTag) {
  return `https://github.com/get-bb/bb/releases/download/${releaseTag}/`;
}
