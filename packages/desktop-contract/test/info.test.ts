import { describe, expect, it } from "vitest";
import {
  bbDesktopInfoSchema,
  bbDesktopSimulatorPopoutRequestSchema,
} from "../src/info.js";

const baseInfo = {
  lastCheckedAt: null,
  latestVersion: "0.0.32",
  pendingVersion: null,
  platform: "macos",
  updateAvailable: true,
  updateDownloaded: false,
  version: "0.0.31",
} as const;

describe("bbDesktopInfoSchema", () => {
  it("accepts both explicit download state and legacy shell payloads", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "downloading",
      }).success,
    ).toBe(true);
    expect(bbDesktopInfoSchema.safeParse(baseInfo).success).toBe(true);
  });

  it("rejects an unknown download state", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "available",
      }).success,
    ).toBe(false);
  });

  it("accepts linux", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "linux",
      }).success,
    ).toBe(true);
  });

  it("rejects win32", () => {
    expect(
      bbDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "win32",
      }).success,
    ).toBe(false);
  });
});

describe("bbDesktopSimulatorPopoutRequestSchema", () => {
  it("accepts only a non-empty environment ID", () => {
    expect(
      bbDesktopSimulatorPopoutRequestSchema.safeParse({
        environmentId: "env_ios",
      }).success,
    ).toBe(true);
    expect(
      bbDesktopSimulatorPopoutRequestSchema.safeParse({ environmentId: "" })
        .success,
    ).toBe(false);
    expect(
      bbDesktopSimulatorPopoutRequestSchema.safeParse({
        environmentId: "env_ios",
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });
});
