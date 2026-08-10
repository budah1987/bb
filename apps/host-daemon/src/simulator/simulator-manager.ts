import { execFile as execFileCallback } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { request as httpRequest } from "node:http";
import { platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SimulatorActiveSession,
  SimulatorAttachResult,
  SimulatorControlAction,
  SimulatorDevice,
  SimulatorStatusResult,
  SimulatorStreamLease,
} from "@bb/host-daemon-contract";
import { jsonValueSchema, type JsonValue } from "@bb/domain";
import { z } from "zod";

const LEASE_TTL_MS = 10 * 60_000;
const COMMAND_TIMEOUT_MS = 60_000;
const ATTACH_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;

const simctlDeviceSchema = z
  .object({
    name: z.string().min(1),
    udid: z.string().min(1),
    state: z.enum(["Booted", "Shutdown"]),
    isAvailable: z.boolean().optional(),
  })
  .passthrough();

const simctlListSchema = z
  .object({
    devices: z.record(z.string(), z.array(simctlDeviceSchema)),
  })
  .passthrough();

const serveSimStateSchema = z
  .object({
    device: z.string().min(1),
    streamUrl: z.string().url(),
  })
  .passthrough();

interface ManagedSession {
  environmentId: string;
  deviceUdid: string;
  deviceName: string;
  streamUrl: string;
  shutdownOnStop: boolean;
}

interface PendingAttach {
  controller: AbortController;
  deviceUdid: string;
  shutdownOnStop: boolean;
}

interface ViewerLease {
  environmentId: string;
  expiresAt: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

export class SimulatorManagerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SimulatorManagerError";
  }
}

export interface SimulatorManagerOptions {
  getShellEnv: () => NodeJS.ProcessEnv;
  now?: () => number;
}

function execFile(
  executable: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<ExecResult> {
  return new Promise((resolvePromise, reject) => {
    execFileCallback(
      executable,
      [...args],
      {
        encoding: "utf8",
        env: options.env,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        signal: options.signal,
        timeout: options.timeoutMs ?? COMMAND_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new SimulatorManagerError("simulator_command_failed", detail));
          return;
        }
        resolvePromise({ stdout, stderr });
      },
    );
  });
}

function execFileBuffer(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFileCallback(
      executable,
      [...args],
      {
        encoding: "buffer",
        env,
        maxBuffer: MAX_COMMAND_OUTPUT_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.toString("utf8").trim() || error.message;
          reject(new SimulatorManagerError("simulator_command_failed", detail));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

function runtimeLabel(runtimeId: string): string {
  const marker = "SimRuntime.";
  const suffix = runtimeId.includes(marker)
    ? runtimeId.slice(runtimeId.indexOf(marker) + marker.length)
    : runtimeId;
  return suffix.replaceAll("-", " ");
}

function runtimeSortKey(runtimeId: string): string {
  return runtimeId.replace(/\D/gu, "").padStart(12, "0");
}

function parseServeSimState(
  stdout: string,
): z.infer<typeof serveSimStateSchema> {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    throw new SimulatorManagerError(
      "simulator_helper_failed",
      "serve-sim returned an unreadable session response.",
    );
  }
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = serveSimStateSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new SimulatorManagerError(
      "simulator_helper_failed",
      "serve-sim did not return a usable stream session.",
    );
  }
  return parsed.data;
}

function activeSession(session: ManagedSession): SimulatorActiveSession {
  return {
    deviceUdid: session.deviceUdid,
    deviceName: session.deviceName,
    state: "running",
  };
}

export class SimulatorManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly pendingAttaches = new Map<string, PendingAttach>();
  private readonly leases = new Map<string, ViewerLease>();
  private readonly now: () => number;
  private gateway: Server | null = null;
  private gatewayPort: number | null = null;
  private serveSimExecutable: string | null = null;

  constructor(private readonly options: SimulatorManagerOptions) {
    this.now = options.now ?? Date.now;
  }

  async status(environmentId: string): Promise<SimulatorStatusResult> {
    if (platform() !== "darwin") {
      return {
        supported: false,
        message: "iOS Simulator requires a Mac with Xcode.",
        devices: [],
        active: null,
      };
    }
    let devices: SimulatorDevice[];
    try {
      devices = await this.listDevices();
    } catch (error) {
      return {
        supported: false,
        message:
          error instanceof Error
            ? error.message
            : "Xcode Simulator tools are unavailable.",
        devices: [],
        active: null,
      };
    }
    const session = this.sessions.get(environmentId) ?? null;
    return {
      supported: true,
      message:
        devices.length === 0
          ? "No iOS Simulator devices are installed. Add a platform in Xcode Settings."
          : null,
      devices,
      active: session ? activeSession(session) : null,
    };
  }

  async attach(
    environmentId: string,
    deviceUdid: string,
  ): Promise<SimulatorAttachResult> {
    this.assertSupported();
    const devices = await this.listDevices();
    const device = devices.find((candidate) => candidate.udid === deviceUdid);
    if (!device) {
      throw new SimulatorManagerError(
        "simulator_device_not_found",
        `Simulator device ${deviceUdid} is unavailable.`,
      );
    }
    const current = this.sessions.get(environmentId);
    if (current?.deviceUdid === deviceUdid) {
      return {
        session: activeSession(current),
        lease: await this.createLease(environmentId),
      };
    }
    if (current) {
      await this.stop(environmentId);
    }
    const conflictingSession = [...this.sessions.values()].find(
      (session) => session.deviceUdid === deviceUdid,
    );
    const shutdownOnStop =
      conflictingSession?.shutdownOnStop ?? device.state !== "Booted";
    if (conflictingSession) {
      await this.stop(conflictingSession.environmentId);
    }
    const pendingAttach: PendingAttach = {
      controller: new AbortController(),
      deviceUdid,
      shutdownOnStop,
    };
    this.pendingAttaches.set(environmentId, pendingAttach);
    let result: ExecResult;
    try {
      result = await execFile(
        process.execPath,
        [
          this.resolveServeSimExecutable(),
          "--detach",
          "--quiet",
          "--codec",
          "mjpeg",
          deviceUdid,
        ],
        {
          env: this.options.getShellEnv(),
          signal: pendingAttach.controller.signal,
          timeoutMs: ATTACH_TIMEOUT_MS,
        },
      );
    } finally {
      if (this.pendingAttaches.get(environmentId) === pendingAttach) {
        this.pendingAttaches.delete(environmentId);
      }
    }
    const state = parseServeSimState(result.stdout);
    const session: ManagedSession = {
      environmentId,
      deviceUdid,
      deviceName: device.name,
      streamUrl: state.streamUrl,
      shutdownOnStop,
    };
    this.sessions.set(environmentId, session);
    return {
      session: activeSession(session),
      lease: await this.createLease(environmentId),
    };
  }

  async createLease(environmentId: string): Promise<SimulatorStreamLease> {
    if (!this.sessions.has(environmentId)) {
      throw new SimulatorManagerError(
        "simulator_not_running",
        "Start a simulator before opening its live stream.",
      );
    }
    const gatewayPort = await this.ensureGateway();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + LEASE_TTL_MS;
    this.leases.set(token, { environmentId, expiresAt });
    return { gatewayPort, token, expiresAt };
  }

  async control(
    environmentId: string,
    action: SimulatorControlAction,
  ): Promise<void> {
    const session = this.requireSession(environmentId);
    let args: string[];
    switch (action.kind) {
      case "tap":
        args = ["tap", String(action.x), String(action.y)];
        break;
      case "gesture":
        args = ["gesture", JSON.stringify(action.points)];
        break;
      case "type":
        args = ["type", action.text];
        break;
      case "button":
        args = ["button", action.button];
        break;
      case "rotate":
        args = ["rotate", action.orientation];
        break;
    }
    await execFile(
      process.execPath,
      [this.resolveServeSimExecutable(), ...args, "-d", session.deviceUdid],
      { env: this.options.getShellEnv() },
    );
  }

  async accessibility(environmentId: string): Promise<JsonValue> {
    const session = this.requireSession(environmentId);
    const response = await fetch(new URL("ax", session.streamUrl));
    if (!response.ok) {
      throw new SimulatorManagerError(
        "simulator_accessibility_failed",
        `Simulator accessibility request failed with HTTP ${response.status}.`,
      );
    }
    const value: unknown = await response.json();
    const parsed = jsonValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new SimulatorManagerError(
        "simulator_accessibility_failed",
        "Simulator accessibility response was not valid JSON.",
      );
    }
    return parsed.data;
  }

  async screenshot(environmentId: string): Promise<Buffer> {
    const session = this.requireSession(environmentId);
    return execFileBuffer(
      "xcrun",
      ["simctl", "io", session.deviceUdid, "screenshot", "-"],
      this.options.getShellEnv(),
    );
  }

  async stop(environmentId: string): Promise<string | null> {
    const pendingAttach = this.pendingAttaches.get(environmentId);
    if (pendingAttach) {
      this.pendingAttaches.delete(environmentId);
      pendingAttach.controller.abort();
      await this.stopDevice(
        pendingAttach.deviceUdid,
        pendingAttach.shutdownOnStop,
      );
    }
    const session = this.sessions.get(environmentId);
    if (!session) return pendingAttach?.deviceUdid ?? null;
    this.sessions.delete(environmentId);
    this.revokeEnvironmentLeases(environmentId);
    await this.stopDevice(session.deviceUdid, session.shutdownOnStop);
    return session.deviceUdid;
  }

  private async stopDevice(
    deviceUdid: string,
    shutdownOnStop: boolean,
  ): Promise<void> {
    await execFile(
      process.execPath,
      [this.resolveServeSimExecutable(), "--kill", deviceUdid, "--quiet"],
      { env: this.options.getShellEnv() },
    ).catch(() => undefined);
    if (shutdownOnStop) {
      await execFile("xcrun", ["simctl", "shutdown", deviceUdid], {
        env: this.options.getShellEnv(),
      }).catch(() => undefined);
    }
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [
        ...new Set([...this.sessions.keys(), ...this.pendingAttaches.keys()]),
      ].map((environmentId) => this.stop(environmentId)),
    );
    this.leases.clear();
    await new Promise<void>((resolvePromise) => {
      if (!this.gateway) {
        resolvePromise();
        return;
      }
      this.gateway.close(() => resolvePromise());
    });
    this.gateway = null;
    this.gatewayPort = null;
  }

  private assertSupported(): void {
    if (platform() !== "darwin") {
      throw new SimulatorManagerError(
        "simulator_unsupported",
        "iOS Simulator requires a Mac with Xcode.",
      );
    }
  }

  private async listDevices(): Promise<SimulatorDevice[]> {
    const result = await execFile(
      "xcrun",
      ["simctl", "list", "devices", "available", "--json"],
      { env: this.options.getShellEnv() },
    );
    let value: unknown;
    try {
      value = JSON.parse(result.stdout);
    } catch {
      throw new SimulatorManagerError(
        "simulator_tools_unavailable",
        "Xcode returned an unreadable simulator device list.",
      );
    }
    const parsed = simctlListSchema.safeParse(value);
    if (!parsed.success) {
      throw new SimulatorManagerError(
        "simulator_tools_unavailable",
        "Xcode returned an unsupported simulator device list.",
      );
    }
    return Object.entries(parsed.data.devices)
      .filter(([runtime]) => runtime.includes("SimRuntime.iOS-"))
      .flatMap(([runtime, devices]) =>
        devices
          .filter((device) => device.isAvailable !== false)
          .map((device) => ({
            udid: device.udid,
            name: device.name,
            runtime: runtimeLabel(runtime),
            state: device.state,
            runtimeKey: runtimeSortKey(runtime),
          })),
      )
      .sort((a, b) => {
        const runtimeOrder = b.runtimeKey.localeCompare(a.runtimeKey);
        if (runtimeOrder !== 0) return runtimeOrder;
        const aPhone = a.name.startsWith("iPhone") ? 0 : 1;
        const bPhone = b.name.startsWith("iPhone") ? 0 : 1;
        return aPhone - bPhone || a.name.localeCompare(b.name);
      })
      .map(({ runtimeKey: _runtimeKey, ...device }) => device);
  }

  private requireSession(environmentId: string): ManagedSession {
    const session = this.sessions.get(environmentId);
    if (!session) {
      throw new SimulatorManagerError(
        "simulator_not_running",
        "No simulator is running for this environment.",
      );
    }
    return session;
  }

  private resolveServeSimExecutable(): string {
    if (this.serveSimExecutable) return this.serveSimExecutable;
    const middlewarePath = fileURLToPath(
      import.meta.resolve("serve-sim/middleware"),
    );
    this.serveSimExecutable = resolve(dirname(middlewarePath), "serve-sim.js");
    return this.serveSimExecutable;
  }

  private revokeEnvironmentLeases(environmentId: string): void {
    for (const [token, lease] of this.leases) {
      if (lease.environmentId === environmentId) this.leases.delete(token);
    }
  }

  private async ensureGateway(): Promise<number> {
    if (this.gateway && this.gatewayPort) return this.gatewayPort;
    const gateway = createServer((request, response) => {
      const requestOrigin = request.headers.origin;
      if (requestOrigin) {
        response.setHeader("Access-Control-Allow-Origin", requestOrigin);
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Vary", "Origin");
      }
      response.setHeader("Access-Control-Allow-Headers", "Authorization");
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }
      if (request.method !== "GET" || request.url !== "/stream.mjpeg") {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length)
        : "";
      const lease = this.leases.get(token);
      if (!lease || lease.expiresAt <= this.now()) {
        if (lease) this.leases.delete(token);
        response.statusCode = 401;
        response.end("Unauthorized");
        return;
      }
      const session = this.sessions.get(lease.environmentId);
      if (!session) {
        response.statusCode = 410;
        response.end("Simulator session ended");
        return;
      }
      const upstreamUrl = new URL(session.streamUrl);
      if (
        upstreamUrl.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "::1"].includes(upstreamUrl.hostname)
      ) {
        response.statusCode = 502;
        response.end("Invalid simulator stream origin");
        return;
      }
      const upstream = httpRequest(upstreamUrl, (upstreamResponse) => {
        response.statusCode = upstreamResponse.statusCode ?? 502;
        const contentType = upstreamResponse.headers["content-type"];
        if (contentType) response.setHeader("Content-Type", contentType);
        upstreamResponse.pipe(response);
        response.once("close", () => upstreamResponse.destroy());
      });
      upstream.on("error", () => {
        if (!response.headersSent) response.statusCode = 502;
        response.end();
      });
      upstream.end();
    });
    await new Promise<void>((resolvePromise, reject) => {
      gateway.once("error", reject);
      gateway.listen(0, "127.0.0.1", () => {
        gateway.removeListener("error", reject);
        resolvePromise();
      });
    });
    const address = gateway.address();
    if (!address || typeof address === "string") {
      gateway.close();
      throw new SimulatorManagerError(
        "simulator_gateway_failed",
        "Could not open the simulator stream gateway.",
      );
    }
    this.gateway = gateway;
    this.gatewayPort = address.port;
    return address.port;
  }
}
