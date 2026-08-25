import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["dist", "node_modules", ".turbo"].includes(entry.name)) continue;
    if (entry.name === "standalone-contract.test.ts") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("portable plugin runtime contract", () => {
  it("does not depend on BB monorepo-only runtime packages or configuration", () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
    };
    const dependencies = manifest.dependencies ?? {};

    expect(dependencies["@bb/shared-ui"]).toBeUndefined();
    expect(Object.values(dependencies)).not.toContain("workspace:*");
    expect(manifest.engines).toMatchObject({
      bb: ">=0.36.0-bbamir.1",
      bbPluginSdk: "^0.4.1",
    });

    for (const file of sourceFiles(pluginRoot)) {
      const source = readFileSync(file, "utf8");
      expect(source, relative(pluginRoot, file)).not.toContain("@bb/shared-ui");
      expect(source, relative(pluginRoot, file)).not.toContain(
        "../../vitest.shared",
      );
    }
  });

  it("keeps the BBamir host capability boundary explicit", () => {
    const capabilities = new Set<string>();

    for (const file of sourceFiles(pluginRoot)) {
      if (file.includes(`${sep}types${sep}`) || /\.test\.[jt]sx?$/.test(file)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bexperimental_[A-Za-z0-9_]+\b/gu)) {
        capabilities.add(match[0]);
      }
    }

    expect([...capabilities].sort()).toEqual([
      "experimental_canOpenForkDraft",
      "experimental_closePane",
      "experimental_contextBar",
      "experimental_fallbackThreadId",
      "experimental_gitRemoteUrl",
      "experimental_githubAccountLogin",
      "experimental_newThreadContextBar",
      "experimental_newThreadEmptyState",
      "experimental_openForkDraft",
      "experimental_registerCloseHandler",
      "experimental_sameEnvironment",
      "experimental_spaces",
      "experimental_startGithubWorkflow",
      "experimental_threadList",
      "experimental_useSidebarThreadActions",
      "experimental_useSidebarThreads",
    ]);
  });
});
