import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));

export interface BundleBootChunk {
  fileName: string;
  bytes: number;
  /** npm package names whose code landed in this chunk. */
  packages: string[];
}

export interface BundleStats {
  chunks: BundleChunk[];
  entry: string;
  bootChunks: BundleBootChunk[];
}

export interface BundleChunk extends BundleBootChunk {
  dynamicEntry: boolean;
  entry: boolean;
  imports: string[];
  moduleCount: number;
  topModules: Array<{ bytes: number; id: string }>;
}

/**
 * Writes `bundle-stats.json` describing the boot payload: the entry chunk and
 * its static-import closure, with the npm packages each one contains.
 *
 * scripts/check-bundle-budget.mjs reads this instead of pattern-matching
 * minified output, so the budget check knows exactly which packages block
 * first paint.
 */
export function bundleStats(): Plugin {
  return {
    name: "bb:bundle-stats",
    apply: "build",
    async writeBundle(_options, bundle) {
      const entry = Object.values(bundle).find(
        (output) => output.type === "chunk" && output.isEntry,
      );
      if (entry === undefined || entry.type !== "chunk") return;

      const bootFileNames = new Set<string>();
      const walk = (fileName: string): void => {
        if (bootFileNames.has(fileName)) return;
        bootFileNames.add(fileName);
        const chunk = bundle[fileName];
        if (chunk === undefined || chunk.type !== "chunk") return;
        for (const imported of chunk.imports) walk(imported);
      };
      walk(entry.fileName);

      const bootChunks: BundleBootChunk[] = [];
      const chunks: BundleChunk[] = [];
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const packages = new Set<string>();
        for (const moduleId of output.moduleIds ?? []) {
          const name = packageNameOf(moduleId);
          if (name !== null) packages.add(name);
        }
        chunks.push({
          fileName: output.fileName,
          bytes: Buffer.byteLength(output.code),
          packages: [...packages].sort(),
          dynamicEntry: output.isDynamicEntry,
          entry: output.isEntry,
          imports: [...output.imports].sort(),
          moduleCount: Object.keys(output.modules).length,
          topModules: Object.entries(output.modules)
            .map(([id, info]) => ({ bytes: info.renderedLength, id }))
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 20),
        });
      }
      for (const fileName of [...bootFileNames].sort()) {
        const chunk = bundle[fileName];
        if (chunk === undefined || chunk.type !== "chunk") continue;
        const packages = new Set<string>();
        for (const moduleId of chunk.moduleIds ?? []) {
          const name = packageNameOf(moduleId);
          if (name !== null) packages.add(name);
        }
        bootChunks.push({
          fileName,
          bytes: Buffer.byteLength(chunk.code),
          packages: [...packages].sort(),
        });
      }

      const stats: BundleStats = {
        entry: entry.fileName,
        bootChunks,
        chunks: chunks.sort((a, b) => b.bytes - a.bytes),
      };
      const target = resolve(appDir, "bundle-stats.json");
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(stats, null, 2)}\n`);
    },
  };
}

/** `.../node_modules/@scope/name/dist/x.js` -> `@scope/name`; app code -> null. */
function packageNameOf(moduleId: string): string | null {
  const marker = moduleId.lastIndexOf("node_modules/");
  if (marker < 0) return null;
  const segments = moduleId.slice(marker + "node_modules/".length).split("/");
  const [first, second] = segments;
  if (first === undefined) return null;
  if (first.startsWith("@")) return second === undefined ? null : `${first}/${second}`;
  return first;
}
