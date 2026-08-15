import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "@get-bb/plugin-sdk/testing/app": fileURLToPath(
        new URL("./test-support/plugin-sdk-testing-app.js", import.meta.url),
      ),
      "@get-bb/plugin-sdk/app": fileURLToPath(
        new URL("./test-support/plugin-sdk-app.js", import.meta.url),
      ),
      "@get-bb/plugin-sdk": fileURLToPath(
        new URL("./test-support/plugin-sdk.js", import.meta.url),
      ),
    },
    conditions: ["source"],
  },
  ssr: {
    resolve: {
      conditions: ["source"],
      externalConditions: ["source"],
    },
  },
  test: {
    silent: "passed-only",
    name: "bb-plugin-conductor-workspaces",
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**"],
    setupFiles: ["./test-support/setup.ts"],
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
  },
});
