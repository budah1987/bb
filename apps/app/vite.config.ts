import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type UserConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { bundleStats } from "./vite-bundle-stats.js";
import { sharedUiEnvSeam } from "./vite-shared-ui-seam.js";

const appDir = dirname(fileURLToPath(import.meta.url));

export const sharedViteConfig = {
  plugins: [
    sharedUiEnvSeam(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    // Build-only: writes bundle-stats.json for the boot-payload budget check.
    bundleStats(),
  ],
  // Keep app and Ladle dep optimization metadata from clobbering each other.
  cacheDir: "node_modules/.vite/app",
  build: {
    // Skip compressed-size calculation to keep production app builds fast.
    reportCompressedSize: false,
    // Single generated language modules can exceed Vite's default warning.
    // CI separately caps every multi-module chunk at 650 KB.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // Keep optional editor, Markdown, and file-tree engines out of one
        // multi-megabyte workspace chunk. These package families have stable
        // public boundaries and no app-owned side-effect ordering.
        codeSplitting: {
          groups: [
            {
              name: "editor-vendor",
              test: /node_modules[\\/](?:@tiptap[\\/]|prosemirror-|orderedmap|rope-sequence|w3c-keyname)/,
              // Keep each lazy entry's circular module graph together.
              entriesAware: true,
              priority: 30,
            },
            {
              name: "markdown-vendor",
              test: /node_modules[\\/](?:react-markdown|remark-|rehype-|mdast-|micromark|hast-|unified|vfile|parse5|entities)/,
              entriesAware: true,
              priority: 25,
            },
            {
              name: "syntax-vendor",
              test: /node_modules[\\/](?:@shikijs[\\/]|shiki[\\/]|oniguruma|regex-recursion|regex-utilities)/,
              entriesAware: true,
              priority: 20,
            },
            {
              name: "workspace-tree-vendor",
              test: /node_modules[\\/](?:@pierre[\\/]trees|handlebars|preact)/,
              entriesAware: true,
              priority: 15,
            },
            {
              name: "diff-vendor",
              test: /node_modules[\\/](?:@pierre[\\/]diffs|@pierre[\\/]utils)/,
              entriesAware: true,
              priority: 15,
            },
          ],
        },
      },
    },
  },
  optimizeDeps: {
    // The terminal imports xterm lazily when the panel mounts. Pre-optimize
    // these packages so opening the terminal does not discover new deps and
    // invalidate Vite's optimized-dependency hash mid-session.
    include: ["@xterm/addon-fit", "@xterm/addon-web-links", "@xterm/xterm"],
  },
  resolve: {
    conditions: ["source"],
    alias: {
      "@get-bb/plugin-sdk/app": resolve(
        appDir,
        "./src/lib/conductor-plugin-sdk-app.ts",
      ),
      "@": resolve(appDir, "./src"),
    },
  },
} satisfies UserConfig;

export default defineConfig(sharedViteConfig);
