import { describe, expect, it } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

describe("T3 project script import", () => {
  it("copies only names and commands and rejects malformed configs before sending", async () => {
    const requests: { url: string; body: unknown }[] = [];
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        runtime: "node",
        fetch: async (url, init) => {
          requests.push({
            url: String(url),
            body: JSON.parse(String(init?.body)),
          });
          return new Response(JSON.stringify({ scripts: [] }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        },
      }),
    });
    await sdk.projects.experimental_scripts.importT3({
      projectId: "proj_test",
      content: JSON.stringify({
        scripts: [
          {
            name: " Dev ",
            command: "pnpm dev",
            icon: "play",
            runOnWorktreeCreate: true,
            runOnSettle: true,
            previewUrl: "http://localhost:3000",
          },
        ],
      }),
    });
    expect(requests).toEqual([
      {
        url: "http://bb.test/api/v1/projects/proj_test/scripts/import",
        body: {
          scripts: [{ name: "Dev", command: "pnpm dev", shortcut: null }],
        },
      },
    ]);
    for (const content of [
      "not json",
      '{"scripts":[{"name":"Bad","command":" "}]}',
      '{"scripts":{}}',
    ]) {
      await expect(
        sdk.projects.experimental_scripts.importT3({
          projectId: "proj_test",
          content,
        }),
      ).rejects.toThrow();
    }
    expect(requests).toHaveLength(1);
  });
});
