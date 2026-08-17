import type { EnvironmentPreviewProvider } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  canFramePreviewProvider,
  resolvePreviewProviderStatus,
  summarizePreviewProviders,
} from "./preview-provider-status";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

function provider(
  overrides: Partial<EnvironmentPreviewProvider> = {},
): EnvironmentPreviewProvider {
  return {
    branchUrl: null,
    deploymentUrl: null,
    environment: null,
    framePolicy: "unknown",
    frameReason: null,
    id: "preview_local",
    kind: "local",
    label: "Local",
    logUrl: null,
    port: 5173,
    shared: true,
    source: "docker",
    state: "ready",
    updatedAt: null,
    url: "http://localhost:5173/",
    ...overrides,
  };
}

describe("preview provider status", () => {
  it("locates a ready local preview by port and a deployment by age", () => {
    expect(
      resolvePreviewProviderStatus({ now: NOW, provider: provider() }),
    ).toEqual({ label: "Ready :5173", tier: "success" });
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({
          kind: "deployment",
          source: "github",
          updatedAt: "2026-08-09T11:52:00.000Z",
          url: "https://preview.example.com/",
        }),
      }),
    ).toEqual({ label: "Ready 8m ago", tier: "success" });
  });

  it("omits the detail rather than guessing it", () => {
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({ url: "https://preview.example.com/" }),
      }),
    ).toEqual({ label: "Ready", tier: "success" });
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({ kind: "deployment", source: "github" }),
      }),
    ).toEqual({ label: "Ready", tier: "success" });
  });

  it("states when a ready provider has no usable address", () => {
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({ url: null }),
      }),
    ).toEqual({ label: "Not shared", tier: "muted" });
  });

  it("keeps unfinished states out of the ready tier", () => {
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({ state: "building" }),
      }),
    ).toEqual({ label: "Building", tier: "warning" });
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({ state: "failed" }),
      }),
    ).toEqual({ label: "Failed", tier: "destructive" });
    expect(
      resolvePreviewProviderStatus({
        now: NOW,
        provider: provider({ state: "unknown" }),
      }),
    ).toEqual({ label: "Unknown", tier: "muted" });
  });
});

describe("preview framing", () => {
  it("frames a ready preview unless framing is known to be blocked", () => {
    expect(canFramePreviewProvider(provider())).toBe(true);
    expect(canFramePreviewProvider(provider({ framePolicy: "allowed" }))).toBe(
      true,
    );
    expect(canFramePreviewProvider(provider({ framePolicy: "blocked" }))).toBe(
      false,
    );
  });

  it("never frames a preview that is not ready or has no address", () => {
    expect(canFramePreviewProvider(provider({ state: "building" }))).toBe(
      false,
    );
    expect(canFramePreviewProvider(provider({ url: null }))).toBe(false);
  });
});

describe("preview summary", () => {
  it("mirrors the worst row", () => {
    const failed = provider({ id: "a", state: "failed" });
    const building = provider({ id: "b", state: "building" });
    const ready = provider({ id: "c" });

    expect(
      summarizePreviewProviders({
        isLoading: false,
        providers: [failed, building, ready],
      }),
    ).toEqual({ label: "1 failed", tier: "destructive" });
    expect(
      summarizePreviewProviders({
        isLoading: false,
        providers: [building, ready],
      }),
    ).toEqual({ label: "1 building", tier: "warning" });
    expect(
      summarizePreviewProviders({ isLoading: false, providers: [ready] }),
    ).toEqual({ label: "1 ready", tier: "muted" });
    expect(
      summarizePreviewProviders({ isLoading: false, providers: [] }),
    ).toEqual({ label: "None", tier: "muted" });
  });
});
