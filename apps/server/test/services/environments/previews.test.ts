import { describe, expect, it, vi } from "vitest";
import { probePreviewFramePolicy } from "../../../src/services/environments/previews.js";

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
