import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
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

describe("standalone plugin contract", () => {
  it("does not depend on BB monorepo-only packages or configuration", () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      engines?: Record<string, string>;
    };
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };

    expect(dependencies["@bb/shared-ui"]).toBeUndefined();
    expect(Object.values(dependencies)).not.toContain("workspace:*");
    expect(manifest.engines).toMatchObject({
      bb: ">=0.36.0-conductor.1",
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
});
