import { describe, expect, it } from "vitest";
import type { EnvironmentPreviewProvider } from "@bb/server-contract";
import { selectAdaptivePreview } from "./EnvironmentSection";

function provider(
  overrides: Partial<EnvironmentPreviewProvider>,
): EnvironmentPreviewProvider {
  return {
    branchUrl: null,
    deploymentUrl: null,
    environment: null,
    framePolicy: "unknown",
    frameReason: null,
    id: "terminal:3000",
    kind: "local",
    label: "Dev server",
    logUrl: null,
    port: 3000,
    shared: false,
    source: "terminal",
    state: "ready",
    updatedAt: null,
    url: null,
    ...overrides,
  };
}

describe("selectAdaptivePreview", () => {
  const local = provider({ id: "terminal:3000" });
  const vercel = provider({
    branchUrl: "https://feature.example.vercel.app",
    deploymentUrl: "https://deployment.example.vercel.app",
    environment: "Preview",
    id: "github:Preview",
    kind: "deployment",
    label: "Preview",
    port: null,
    source: "github",
    url: "https://feature.example.vercel.app",
  });

  it("uses Vercel automatically when a deployment exists", () => {
    expect(
      selectAdaptivePreview({ preference: "auto", providers: [local, vercel] }),
    ).toEqual({ provider: vercel, source: "vercel" });
  });

  it("keeps local preview available as an explicit override", () => {
    expect(
      selectAdaptivePreview({
        preference: "local",
        providers: [local, vercel],
      }),
    ).toEqual({ provider: local, source: "local" });
  });

  it("falls back when a stored source is no longer available", () => {
    expect(
      selectAdaptivePreview({ preference: "vercel", providers: [local] }),
    ).toEqual({ provider: local, source: "local" });
    expect(
      selectAdaptivePreview({ preference: "local", providers: [vercel] }),
    ).toEqual({ provider: vercel, source: "vercel" });
  });

  it("does not select a database port over a web service", () => {
    const database = provider({
      id: "docker:postgres:5432",
      label: "postgres-db",
      port: 5432,
      source: "docker",
    });
    const web = provider({
      id: "docker:web:3000",
      label: "web",
      port: 3000,
      source: "docker",
    });

    expect(
      selectAdaptivePreview({
        preference: "local",
        providers: [database, web],
      }),
    ).toEqual({ provider: web, source: "local" });
  });
});
