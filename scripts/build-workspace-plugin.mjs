import { readFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  buildPluginApp,
  buildPluginServer,
  resolvePluginBuildToolchain,
} from "../packages/plugin-build/src/index.ts";

const repositoryRoot = resolve(import.meta.dirname, "..");
const pluginName = process.argv[2];

if (pluginName === undefined || basename(pluginName) !== pluginName) {
  throw new Error("usage: build-workspace-plugin.mjs <plugin-directory-name>");
}

const rootDirectory = resolve(repositoryRoot, "plugins", pluginName);
const [pluginPackage, bbPackage] = await Promise.all([
  readFile(resolve(rootDirectory, "package.json"), "utf8").then(JSON.parse),
  readFile(
    resolve(repositoryRoot, "packages/bb-app/package.json"),
    "utf8",
  ).then(JSON.parse),
]);

if (typeof pluginPackage.bb?.server !== "string") {
  throw new Error(`${pluginName} is missing a bb.server entry`);
}
if (typeof bbPackage.version !== "string") {
  throw new Error("packages/bb-app/package.json is missing a version");
}

const toolchain = await resolvePluginBuildToolchain(
  resolve(repositoryRoot, "node_modules/.bb-toolchain"),
);
await rm(resolve(rootDirectory, "dist"), { recursive: true, force: true });

const server = await buildPluginServer(
  rootDirectory,
  bbPackage.version,
  toolchain,
);
const files = [server.jsPath, server.mapPath, server.metaPath];

if (typeof pluginPackage.bb.app === "string") {
  const app = await buildPluginApp(rootDirectory, bbPackage.version, toolchain);
  files.push(app.jsPath, app.cssPath, app.metaPath);
}

for (const file of files) console.log(file);
