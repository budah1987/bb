import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    silent: "passed-only",
    testTimeout: process.platform === "win32" ? 60_000 : 5_000,
    name: "bb-plugin-provider-pi",
    include: ["*.test.ts", "*.test.tsx", "src/**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
