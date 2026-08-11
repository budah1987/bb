import { describe, expect, it, vi } from "vitest";
import {
  buildVercelProtectionBypassUrl,
  probePreviewFramePolicy,
  terminalOutputHasActiveBuildError,
} from "../../../src/services/environments/previews.js";

function terminalOutput(text: string) {
  return {
    chunks: [
      {
        dataBase64: Buffer.from(text).toString("base64"),
        seq: 1,
      },
    ],
    nextSeq: 2,
    truncated: false,
  };
}

describe("terminalOutputHasActiveBuildError", () => {
  it("detects a Vite HMR error after the last successful build", () => {
    expect(
      terminalOutputHasActiveBuildError(
        terminalOutput(
          "ready in 200 ms\n[vite] Internal server error: Cannot resolve module",
        ),
      ),
    ).toBe(true);
  });

  it("does not treat an HMR failure line as a recovery", () => {
    expect(
      terminalOutputHasActiveBuildError(
        terminalOutput("ready in 200 ms\nHMR update failed"),
      ),
    ).toBe(true);
  });

  it("clears the error after a later successful HMR update", () => {
    expect(
      terminalOutputHasActiveBuildError(
        terminalOutput(
          "[vite] Internal server error: Cannot resolve module\n[vite] hmr update /src/App.tsx",
        ),
      ),
    ).toBe(false);
  });

  it("does not treat ordinary stderr text as a build failure", () => {
    expect(
      terminalOutputHasActiveBuildError(
        terminalOutput(
          "Warning: experimental feature enabled\nready in 200 ms",
        ),
      ),
    ).toBe(false);
  });
});

describe("buildVercelProtectionBypassUrl", () => {
  it("adds the automation secret and iframe cookie request", () => {
    const result = buildVercelProtectionBypassUrl(
      "https://feature.vercel.app/path?view=full",
      "secret value",
    );

    if (result === null) throw new Error("Expected a bypass URL");
    const url = new URL(result);
    expect(url.searchParams.get("view")).toBe("full");
    expect(url.searchParams.get("x-vercel-protection-bypass")).toBe(
      "secret value",
    );
    expect(url.searchParams.get("x-vercel-set-bypass-cookie")).toBe(
      "samesitenone",
    );
  });

  it("rejects non-Vercel and non-HTTPS preview URLs", () => {
    expect(
      buildVercelProtectionBypassUrl("https://preview.example.com", "secret"),
    ).toBeNull();
    expect(
      buildVercelProtectionBypassUrl("http://feature.vercel.app", "secret"),
    ).toBeNull();
  });
});

describe("probePreviewFramePolicy", () => {
  it("reports an allowlisted deployment that permits framing", async () => {
    const request = vi.fn(
      async () => new Response(null, { status: 200, headers: {} }),
    );

    await expect(
      probePreviewFramePolicy("https://feature.vercel.app", request),
    ).resolves.toEqual({ framePolicy: "allowed", frameReason: null });
    expect(request).toHaveBeenCalledOnce();
  });

  it("reports X-Frame-Options as blocked", async () => {
    const request = vi.fn(
      async () =>
        new Response(null, {
          status: 200,
          headers: { "x-frame-options": "DENY" },
        }),
    );

    await expect(
      probePreviewFramePolicy("https://feature.vercel.app", request),
    ).resolves.toEqual({
      framePolicy: "blocked",
      frameReason: "The deployment blocks embedding.",
    });
  });

  it("does not request a custom deployment host", async () => {
    const request = vi.fn();

    await expect(
      probePreviewFramePolicy("https://preview.example.com", request),
    ).resolves.toEqual({
      framePolicy: "unknown",
      frameReason: "BB does not probe custom deployment hosts.",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("stops a redirect before it reaches a custom host", async () => {
    const request = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://internal.example.com/preview" },
        }),
    );

    await expect(
      probePreviewFramePolicy("https://feature.vercel.app", request),
    ).resolves.toEqual({
      framePolicy: "unknown",
      frameReason: "BB stopped a deployment probe at an untrusted host.",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
