import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  BrowserAttachTracker,
  collectRendererProcessMetrics,
  parsePackagedPerformanceDriverArgs,
  parseProcessTable,
  performancePhase,
} from "../src/packaged-performance-driver.js";
import type { DesktopPerformanceRun } from "../src/desktop-performance-budget.js";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "./desktop-release-channel.mjs";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const releaseDir = join(packageRoot, "release");
const startupTimeoutMs = 60_000;

const cdpTargetSchema = z
  .object({
    id: z.string().min(1),
    type: z.string(),
    url: z.string(),
    webSocketDebuggerUrl: z.string().optional(),
  })
  .passthrough();
const cdpTargetsSchema = z.array(cdpTargetSchema);

interface CdpResponse {
  error?: { message?: string };
  id?: number;
  result?: { result?: { value?: unknown } };
}

class CdpClient {
  readonly #pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (value: unknown) => void }
  >();
  readonly #socket: WebSocket;
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data)) as CdpResponse;
      if (response.id === undefined) return;
      const pending = this.#pending.get(response.id);
      if (pending === undefined) return;
      this.#pending.delete(response.id);
      if (response.error !== undefined) {
        pending.reject(
          new Error(response.error.message ?? "CDP command failed"),
        );
        return;
      }
      pending.resolve(response.result ?? {});
    });
    socket.addEventListener("close", () => {
      for (const pending of this.#pending.values()) {
        pending.reject(new Error("CDP connection closed"));
      }
      this.#pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await Promise.race([
      once(socket, "open"),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Timed out opening CDP")), 10_000);
      }),
    ]);
    return new CdpClient(socket);
  }

  async evaluate(expression: string): Promise<unknown> {
    const response = (await this.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    })) as CdpResponse["result"];
    return response?.result?.value;
  }

  close(): void {
    this.#socket.close();
  }

  private async send(method: string, params: object): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    const response = new Promise<unknown>((resolvePromise, rejectPromise) => {
      this.#pending.set(id, { reject: rejectPromise, resolve: resolvePromise });
    });
    this.#socket.send(JSON.stringify({ id, method, params }));
    return await response;
  }
}

async function reservePorts(count: number): Promise<number[]> {
  const servers = Array.from({ length: count }, () => createServer());
  try {
    await Promise.all(
      servers.map(async (server) => {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
      }),
    );
    return servers.map((server) => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Could not reserve a local port");
      }
      return address.port;
    });
  } finally {
    await Promise.all(
      servers.map(async (server) => {
        if (!server.listening) return;
        server.close();
        await once(server, "close");
      }),
    );
  }
}

async function resolvePackagedAppBinary(): Promise<string> {
  const releaseConfig = createDesktopReleaseConfig(
    resolveDesktopReleaseChannel(process.env),
  );
  const relativeBinaryPath = join(
    `${releaseConfig.applicationName}.app`,
    "Contents",
    "MacOS",
    releaseConfig.applicationName,
  );
  const entries = await readdir(releaseDir, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory() || !entry.name.startsWith("mac")) continue;
    const binaryPath = join(releaseDir, entry.name, relativeBinaryPath);
    try {
      await access(binaryPath);
      return binaryPath;
    } catch {
      continue;
    }
  }
  throw new Error(`No packaged desktop app was found under ${releaseDir}`);
}

async function readTargets(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok)
    throw new Error(`CDP target request failed: ${response.status}`);
  return cdpTargetsSchema.parse(await response.json());
}

async function connectMainRenderer(
  port: number,
  shouldStop: () => boolean,
): Promise<{
  client: CdpClient;
  targetId: string;
}> {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = "no renderer target";
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("Packaged renderer startup stopped");
    try {
      const targets = await readTargets(port);
      for (const target of targets) {
        if (target.type !== "page" || target.webSocketDebuggerUrl === undefined)
          continue;
        const client = await CdpClient.connect(target.webSocketDebuggerUrl);
        const isBbDesktop = await client.evaluate(
          "typeof window.bbDesktop === 'object' && window.bbDesktop !== null",
        );
        if (isBbDesktop === true) return { client, targetId: target.id };
        client.close();
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for the packaged renderer: ${lastError}`);
}

async function waitForTaskLinks(
  client: CdpClient,
  shouldStop: () => boolean,
): Promise<void> {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (shouldStop()) throw new Error("Packaged task discovery stopped");
    const count = await client.evaluate(
      "document.querySelectorAll('[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]').length",
    );
    if (typeof count === "number" && count >= 2) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(
    "The isolated fixture must expose at least two sidebar tasks",
  );
}

async function switchTask(client: CdpClient, taskIndex: number): Promise<void> {
  const result = await client.evaluate(`(() => {
    const links = [...document.querySelectorAll('[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]')]
      .filter((element) => element instanceof HTMLAnchorElement);
    if (links.length < 2) return { count: links.length, switched: false };
    const currentPath = window.location.pathname;
    const candidates = links.filter((link) => new URL(link.href).pathname !== currentPath);
    const target = candidates[${String(taskIndex)} % candidates.length];
    if (!(target instanceof HTMLAnchorElement)) return { count: links.length, switched: false };
    target.click();
    return { count: links.length, switched: true };
  })()`);
  if (
    typeof result !== "object" ||
    result === null ||
    !("switched" in result) ||
    result.switched !== true
  ) {
    throw new Error("Could not switch between isolated fixture tasks");
  }
}

async function initializeNativeBrowser(client: CdpClient): Promise<boolean> {
  return (
    (await client.evaluate(`(() => {
      const browser = window.bbDesktop?.browser;
      if (typeof browser?.attach !== "function") return false;
      browser.attach({
        tabId: "packaged-performance-browser",
        url: "",
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
      });
      return true;
    })()`)) === true
  );
}

async function readRendererMetrics(
  rootPid: number,
  previousCpuTimesByPid: ReadonlyMap<number, number>,
  intervalMs: number,
) {
  const { stdout } = await execFileAsync("ps", [
    "-axo",
    "pid=,ppid=,rss=,time=,command=",
  ]);
  return collectRendererProcessMetrics({
    intervalMs,
    previousCpuTimesByPid,
    rootPid,
    rows: parseProcessTable(stdout),
  });
}

async function writeArtifact(
  outputPath: string,
  run: DesktopPerformanceRun,
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    once(child, "exit"),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
}

async function seedPerformanceFixture(dataDir: string): Promise<void> {
  const child = spawn(
    "pnpm",
    ["--dir", repoRoot, "seed:perf", "--", "--data-dir", dataDir, "--reset"],
    { env: process.env, stdio: "inherit" },
  );
  const [code, signal] = await once(child, "exit");
  if (code !== 0) {
    throw new Error(
      `Performance fixture seed failed: code=${String(code)} signal=${String(signal)}`,
    );
  }
}

async function main(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "Packaged desktop performance recording only runs on macOS",
    );
  }
  const options = parsePackagedPerformanceDriverArgs(
    process.argv.slice(2),
    process.cwd(),
  );
  const appBinary = await resolvePackagedAppBinary();
  const runRoot = await mkdtemp(join(tmpdir(), "bb-packaged-performance-"));
  const isolatedDataDir = join(runRoot, "data");
  const userDataDir = join(runRoot, "electron-user-data");
  let child: ChildProcess | null = null;
  let client: CdpClient | null = null;
  let interrupted = false;
  const handleInterrupt = (): void => {
    interrupted = true;
  };
  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleInterrupt);

  try {
    await seedPerformanceFixture(isolatedDataDir);

    const [serverPort, hostDaemonPort, cdpPort] = await reservePorts(3);
    if (
      serverPort === undefined ||
      hostDaemonPort === undefined ||
      cdpPort === undefined
    ) {
      throw new Error("Could not reserve packaged performance ports");
    }
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      BB_DATA_DIR: isolatedDataDir,
      BB_DESKTOP_OPEN_DEVTOOLS: "0",
      BB_HOST_DAEMON_PORT: String(hostDaemonPort),
      BB_SERVER_PORT: String(serverPort),
    };
    delete childEnv.BB_DESKTOP_APP_URL;
    delete childEnv.ELECTRON_RUN_AS_NODE;
    child = spawn(
      appBinary,
      [`--user-data-dir=${userDataDir}`, `--remote-debugging-port=${cdpPort}`],
      { env: childEnv, stdio: "inherit" },
    );
    const rootPid = child.pid;
    if (rootPid === undefined) {
      throw new Error("The packaged desktop app did not start");
    }
    const shouldStop = () =>
      interrupted ||
      child === null ||
      child.exitCode !== null ||
      child.signalCode !== null;
    const connection = await connectMainRenderer(cdpPort, shouldStop);
    client = connection.client;
    await waitForTaskLinks(client, shouldStop);
    const browserAttachTracker = new BrowserAttachTracker(connection.targetId);
    const nativeBrowserAvailable = await initializeNativeBrowser(client);
    if (nativeBrowserAvailable) {
      const browserTargetDeadline = Date.now() + 5_000;
      while (Date.now() < browserTargetDeadline) {
        if (browserAttachTracker.observe(await readTargets(cdpPort)) > 0) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
      }
    }
    const run: DesktopPerformanceRun = { samples: [], schemaVersion: 1 };
    const startedAt = performance.now();
    let previousSampleAt = startedAt;
    let previousCpuTimesByPid = new Map<number, number>();
    let nextSampleAt = 0;
    let nextSwitchAt = 0;
    let taskIndex = 0;

    while (true) {
      if (interrupted) throw new Error("Performance recording was interrupted");
      const elapsedMs = Math.round(performance.now() - startedAt);
      const phase = performancePhase({
        durationMs: options.durationMs,
        elapsedMs,
        idleDurationMs: options.idleDurationMs,
      });
      if (phase === "workload" && elapsedMs >= nextSwitchAt) {
        await switchTask(client, taskIndex);
        taskIndex += 1;
        nextSwitchAt += options.taskSwitchIntervalMs;
      }
      if (elapsedMs >= nextSampleAt) {
        const sampledAt = performance.now();
        const metrics = await readRendererMetrics(
          rootPid,
          previousCpuTimesByPid,
          Math.max(1, sampledAt - previousSampleAt),
        );
        previousCpuTimesByPid = new Map(metrics.cpuTimesByPid);
        previousSampleAt = sampledAt;
        const targets = await readTargets(cdpPort);
        run.samples.push({
          browserAttachCount: browserAttachTracker.observe(targets),
          elapsedMs,
          phase,
          rendererCpuPercent: metrics.cpuPercent,
          rendererWorkingSetKb: metrics.workingSetKb,
        });
        await writeArtifact(options.outputPath, run);
        process.stdout.write(
          `sample ${String(run.samples.length)}: ${String(elapsedMs)}ms, ${phase}, ${String(metrics.processCount)} renderers\n`,
        );
        nextSampleAt += options.sampleIntervalMs;
      }
      if (elapsedMs >= options.durationMs) break;
      const nextEventAt = Math.min(
        nextSampleAt,
        phase === "workload" ? nextSwitchAt : nextSampleAt,
        options.durationMs,
      );
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, Math.max(10, nextEventAt - elapsedMs)),
      );
    }
    process.stdout.write(`Performance artifact: ${options.outputPath}\n`);
  } finally {
    process.off("SIGINT", handleInterrupt);
    process.off("SIGTERM", handleInterrupt);
    client?.close();
    if (child !== null) await stopChild(child);
    await rm(runRoot, { force: true, recursive: true });
  }
}

await main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
