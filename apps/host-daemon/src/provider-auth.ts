import { randomUUID } from "node:crypto";
import { spawn as spawnPty, type IPty } from "node-pty";
import { z } from "zod";
import {
  providerAuthSnapshotSchema,
  type ProviderAuthKey,
  type ProviderAuthSession,
  type ProviderAuthSnapshot,
  type ProviderAuthStatus,
} from "@bb/host-daemon-contract";
import {
  readCodexAuthCredentials,
  type CodexAuthCredentials,
} from "./codex-auth.js";
import type { HostDaemonLogger } from "./logger.js";
import {
  createSpawnProviderCliCommandRunner,
  type ProviderCliCommandRunner,
} from "./provider-cli-health.js";
import { ensureNodePtySpawnHelperExecutable } from "./terminals/terminal-manager.js";

const AUTH_STATUS_TIMEOUT_MS = 5_000;
const AUTH_DOCTOR_TIMEOUT_MS = 30_000;
const AUTH_START_READY_TIMEOUT_MS = 12_000;
const AUTH_SUBMIT_TIMEOUT_MS = 60_000;
const AUTH_OUTPUT_LIMIT = 64 * 1024;
const CLAUDE_KEYCHAIN_UNLOCK_COMMAND =
  "security unlock-keychain ~/Library/Keychains/login.keychain-db";

const claudeStatusOutputSchema = z
  .object({
    loggedIn: z.boolean(),
    authMethod: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    orgName: z.string().min(1).optional(),
  })
  .passthrough();

const providerAuthNodePtyLogger: HostDaemonLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export interface ProviderAuthProcess {
  onData(listener: (data: string) => void): void;
  onExit(listener: (exitCode: number) => void): void;
  write(data: string): void;
  kill(): void;
}

export interface ProviderAuthProcessSpawner {
  spawn(args: {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  }): ProviderAuthProcess;
}

interface ManagedProviderAuthSession {
  publicState: ProviderAuthSession;
  process: ProviderAuthProcess;
  env: NodeJS.ProcessEnv;
  output: string;
  submittedCode: string | null;
  ready: Promise<void>;
  resolveReady: () => void;
  finished: Promise<void>;
  resolveFinished: () => void;
  finalized: boolean;
}

export interface ProviderAuthManagerOptions {
  processSpawner?: ProviderAuthProcessSpawner;
  runnerFactory?: (env: NodeJS.ProcessEnv) => ProviderCliCommandRunner;
  readCodexCredentials?: () => Promise<CodexAuthCredentials>;
  now?: () => number;
  createId?: () => string;
  nodePlatform?: NodeJS.Platform;
}

interface ReadProviderAuthStatusesOptions {
  env: NodeJS.ProcessEnv;
  runnerFactory?: (env: NodeJS.ProcessEnv) => ProviderCliCommandRunner;
  readCodexCredentials?: () => Promise<CodexAuthCredentials>;
}

function emptyStatus(args: {
  provider: ProviderAuthKey;
  displayName: string;
  state: ProviderAuthStatus["state"];
  message?: string | null;
}): ProviderAuthStatus {
  return {
    provider: args.provider,
    displayName: args.displayName,
    state: args.state,
    authMethod: null,
    accountEmail: null,
    organizationName: null,
    message: args.message ?? null,
  };
}

function commandUnavailable(errorMessage: string | null): boolean {
  return (
    errorMessage !== null &&
    /ENOENT|not found|could not find|cannot find/iu.test(errorMessage)
  );
}

async function readClaudeAuthStatus(
  runner: ProviderCliCommandRunner,
): Promise<ProviderAuthStatus> {
  const result = await runner.run({
    command: "claude",
    args: ["auth", "status"],
    timeoutMs: AUTH_STATUS_TIMEOUT_MS,
  });
  if (commandUnavailable(result.errorMessage)) {
    return emptyStatus({
      provider: "claudeCode",
      displayName: "Claude Code",
      state: "unavailable",
    });
  }
  try {
    const parsed = claudeStatusOutputSchema.parse(JSON.parse(result.stdout));
    return {
      provider: "claudeCode",
      displayName: "Claude Code",
      state: parsed.loggedIn ? "loggedIn" : "loggedOut",
      authMethod: parsed.authMethod ?? null,
      accountEmail: parsed.email ?? null,
      organizationName: parsed.orgName ?? null,
      message: null,
    };
  } catch {
    return emptyStatus({
      provider: "claudeCode",
      displayName: "Claude Code",
      state: "unknown",
      message: "Claude Code authentication status could not be read.",
    });
  }
}

function codexAuthMethod(output: string): string | null {
  if (/using ChatGPT/iu.test(output)) return "chatgpt";
  if (/using (?:an )?API key/iu.test(output)) return "apiKey";
  if (/using (?:an )?access token/iu.test(output)) return "accessToken";
  return null;
}

async function readCodexAuthStatus(args: {
  runner: ProviderCliCommandRunner;
  readCredentials: () => Promise<CodexAuthCredentials>;
}): Promise<ProviderAuthStatus> {
  const result = await args.runner.run({
    command: "codex",
    args: ["login", "status"],
    timeoutMs: AUTH_STATUS_TIMEOUT_MS,
  });
  if (commandUnavailable(result.errorMessage)) {
    return emptyStatus({
      provider: "codex",
      displayName: "Codex",
      state: "unavailable",
    });
  }
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode !== 0) {
    return emptyStatus({
      provider: "codex",
      displayName: "Codex",
      state: /not logged in|logged out|run [`']?codex login/iu.test(output)
        ? "loggedOut"
        : "unknown",
      message: /not logged in|logged out|run [`']?codex login/iu.test(output)
        ? null
        : "Codex authentication status could not be read.",
    });
  }
  let accountEmail: string | null = null;
  try {
    const credentials = await args.readCredentials();
    accountEmail =
      credentials.type === "chatgpt" ? credentials.accountEmail : null;
  } catch {
    // Codex can store credentials in the OS keyring instead of auth.json.
  }
  return {
    provider: "codex",
    displayName: "Codex",
    state: "loggedIn",
    authMethod: codexAuthMethod(output),
    accountEmail,
    organizationName: null,
    message: null,
  };
}

export async function readProviderAuthStatuses({
  env,
  runnerFactory = createSpawnProviderCliCommandRunner,
  readCodexCredentials = readCodexAuthCredentials,
}: ReadProviderAuthStatusesOptions): Promise<
  Record<ProviderAuthKey, ProviderAuthStatus>
> {
  const runner = runnerFactory(env);
  const [claudeCode, codex] = await Promise.all([
    readClaudeAuthStatus(runner),
    readCodexAuthStatus({ runner, readCredentials: readCodexCredentials }),
  ]);
  return { claudeCode, codex };
}

function stripTerminalFormatting(value: string): string {
  return value
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/gu, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r/gu, "");
}

function extractUrls(output: string): string[] {
  return [...output.matchAll(/https:\/\/[^\s<>"']+/giu)]
    .map((match) => match[0].replace(/[),.;]+$/u, ""))
    .filter((url) => urlHostname(url) !== null);
}

function urlHostname(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function preferredOauthUrl(
  provider: ProviderAuthKey,
  output: string,
): string | null {
  const urls = extractUrls(output);
  const preferred =
    provider === "claudeCode"
      ? urls.find((url) => urlHostname(url) === "claude.ai")
      : urls.find((url) => {
          const host = urlHostname(url);
          return host === "auth.openai.com" || host === "chatgpt.com";
        });
  return preferred ?? urls[0] ?? null;
}

function codexDeviceCode(output: string): string | null {
  return /\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/u.exec(output)?.[0] ?? null;
}

function authCommand(provider: ProviderAuthKey): {
  command: string;
  args: string[];
} {
  return provider === "claudeCode"
    ? { command: "claude", args: ["auth", "login", "--claudeai"] }
    : { command: "codex", args: ["login", "--device-auth"] };
}

function isActivePhase(phase: ProviderAuthSession["phase"]): boolean {
  return (
    phase === "starting" ||
    phase === "waitingForUser" ||
    phase === "waitingForCode" ||
    phase === "verifying"
  );
}

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

export function createPtyProviderAuthProcessSpawner(): ProviderAuthProcessSpawner {
  return {
    spawn(args) {
      ensureNodePtySpawnHelperExecutable(providerAuthNodePtyLogger);
      const pty: IPty = spawnPty(args.command, args.args, {
        // OAuth URLs can be long. A wide PTY prevents line wrapping.
        cols: 2_000,
        cwd: process.cwd(),
        env: args.env,
        name: "xterm-256color",
        rows: 30,
      });
      return {
        onData(listener) {
          pty.onData(listener);
        },
        onExit(listener) {
          pty.onExit((event) => listener(event.exitCode));
        },
        write(data) {
          pty.write(data);
        },
        kill() {
          pty.kill();
        },
      };
    },
  };
}

export class ProviderAuthManager {
  private readonly sessions = new Map<
    ProviderAuthKey,
    ManagedProviderAuthSession
  >();
  private readonly processSpawner: ProviderAuthProcessSpawner;
  private readonly runnerFactory: (
    env: NodeJS.ProcessEnv,
  ) => ProviderCliCommandRunner;
  private readonly readCodexCredentials: () => Promise<CodexAuthCredentials>;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly nodePlatform: NodeJS.Platform;

  constructor(options: ProviderAuthManagerOptions = {}) {
    this.processSpawner =
      options.processSpawner ?? createPtyProviderAuthProcessSpawner();
    this.runnerFactory =
      options.runnerFactory ?? createSpawnProviderCliCommandRunner;
    this.readCodexCredentials =
      options.readCodexCredentials ?? readCodexAuthCredentials;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? randomUUID;
    this.nodePlatform = options.nodePlatform ?? process.platform;
  }

  async snapshot(env: NodeJS.ProcessEnv): Promise<ProviderAuthSnapshot> {
    const statuses = await readProviderAuthStatuses({
      env,
      runnerFactory: this.runnerFactory,
      readCodexCredentials: this.readCodexCredentials,
    });
    return providerAuthSnapshotSchema.parse({
      statuses,
      sessions: [...this.sessions.values()].map(
        (session) => session.publicState,
      ),
    });
  }

  async start(
    provider: ProviderAuthKey,
    env: NodeJS.ProcessEnv,
  ): Promise<ProviderAuthSnapshot> {
    const current = this.sessions.get(provider);
    if (current && isActivePhase(current.publicState.phase)) {
      return this.snapshot(env);
    }
    if (current) this.sessions.delete(provider);

    const statuses = await readProviderAuthStatuses({
      env,
      runnerFactory: this.runnerFactory,
      readCodexCredentials: this.readCodexCredentials,
    });
    const startedWhileChecking = this.sessions.get(provider);
    if (
      startedWhileChecking &&
      isActivePhase(startedWhileChecking.publicState.phase)
    ) {
      return this.snapshot(env);
    }
    if (statuses[provider].state === "loggedIn") {
      return providerAuthSnapshotSchema.parse({
        statuses,
        sessions: [...this.sessions.values()].map(
          (session) => session.publicState,
        ),
      });
    }

    try {
      const session = this.createSession(provider, env);
      this.sessions.set(provider, session);
      await withTimeout(session.ready, AUTH_START_READY_TIMEOUT_MS);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Provider login could not start.";
      this.sessions.set(
        provider,
        this.createFailedSession(provider, env, message),
      );
    }
    return this.snapshot(env);
  }

  async submitCode(
    sessionId: string,
    code: string,
    env: NodeJS.ProcessEnv,
  ): Promise<ProviderAuthSnapshot> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.publicState.sessionId === sessionId,
    );
    if (!session || session.publicState.provider !== "claudeCode") {
      throw new Error("Claude Code login session was not found.");
    }
    if (session.publicState.phase !== "waitingForCode") {
      throw new Error("Claude Code login is not waiting for a code.");
    }
    session.submittedCode = code;
    session.output = "";
    session.publicState.phase = "verifying";
    session.publicState.message = "Verifying Claude Code login…";
    session.process.write(`${code}\r`);
    await withTimeout(session.finished, AUTH_SUBMIT_TIMEOUT_MS);
    return this.snapshot(env);
  }

  private createSession(
    provider: ProviderAuthKey,
    env: NodeJS.ProcessEnv,
  ): ManagedProviderAuthSession {
    const command = authCommand(provider);
    const process = this.processSpawner.spawn({ ...command, env });
    let resolveReady = () => {};
    let resolveFinished = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const session: ManagedProviderAuthSession = {
      publicState: {
        sessionId: this.createId(),
        provider,
        phase: "starting",
        oauthUrl: null,
        userCode: null,
        codeInputRequired: provider === "claudeCode",
        message: `Starting ${provider === "claudeCode" ? "Claude Code" : "Codex"} login…`,
        recoveryCommand: null,
        startedAt: this.now(),
      },
      process,
      env,
      output: "",
      submittedCode: null,
      ready,
      resolveReady,
      finished,
      resolveFinished,
      finalized: false,
    };
    process.onData((data) => this.handleOutput(session, data));
    process.onExit(() => void this.finalize(session));
    return session;
  }

  private createFailedSession(
    provider: ProviderAuthKey,
    env: NodeJS.ProcessEnv,
    message: string,
  ): ManagedProviderAuthSession {
    const settled = Promise.resolve();
    return {
      publicState: {
        sessionId: this.createId(),
        provider,
        phase: "failed",
        oauthUrl: null,
        userCode: null,
        codeInputRequired: provider === "claudeCode",
        message,
        recoveryCommand: null,
        startedAt: this.now(),
      },
      process: {
        onData() {},
        onExit() {},
        write() {},
        kill() {},
      },
      env,
      output: "",
      submittedCode: null,
      ready: settled,
      resolveReady() {},
      finished: settled,
      resolveFinished() {},
      finalized: true,
    };
  }

  private handleOutput(
    session: ManagedProviderAuthSession,
    data: string,
  ): void {
    let clean = stripTerminalFormatting(data);
    if (session.submittedCode) {
      clean = clean.replaceAll(session.submittedCode, "[redacted]");
    }
    session.output = `${session.output}${clean}`.slice(-AUTH_OUTPUT_LIMIT);

    const oauthUrl = preferredOauthUrl(
      session.publicState.provider,
      session.output,
    );
    if (oauthUrl) session.publicState.oauthUrl = oauthUrl;
    if (session.publicState.provider === "claudeCode" && oauthUrl) {
      session.publicState.phase = "waitingForCode";
      session.publicState.message =
        "Open the link, then paste the one-time code here.";
      session.resolveReady();
      return;
    }

    const userCode = codexDeviceCode(session.output);
    if (session.publicState.provider === "codex" && userCode) {
      session.publicState.userCode = userCode;
      session.publicState.phase = "waitingForUser";
      session.publicState.message =
        "Open ChatGPT and enter this one-time code.";
      session.resolveReady();
    }
  }

  private async finalize(session: ManagedProviderAuthSession): Promise<void> {
    if (session.finalized) return;
    session.finalized = true;
    session.resolveReady();

    const statuses = await readProviderAuthStatuses({
      env: session.env,
      runnerFactory: this.runnerFactory,
      readCodexCredentials: this.readCodexCredentials,
    });
    const status = statuses[session.publicState.provider];
    if (status.state === "loggedIn") {
      session.publicState.phase = "succeeded";
      session.publicState.message = `${status.displayName} login succeeded.`;
      session.submittedCode = null;
      session.resolveFinished();
      return;
    }

    if (
      session.publicState.provider === "claudeCode" &&
      /login successful/iu.test(session.output)
    ) {
      const doctor = await this.runnerFactory(session.env).run({
        command: "claude",
        args: ["doctor"],
        timeoutMs: AUTH_DOCTOR_TIMEOUT_MS,
      });
      const doctorOutput = `${doctor.stdout}\n${doctor.stderr}`;
      if (
        this.nodePlatform === "darwin" &&
        /keychain is not writable|security unlock-keychain/iu.test(doctorOutput)
      ) {
        session.publicState.phase = "recoveryRequired";
        session.publicState.message =
          "Unlock the macOS login keychain locally, then start login again. BB never asks for your keychain password.";
        session.publicState.recoveryCommand = CLAUDE_KEYCHAIN_UNLOCK_COMMAND;
        session.submittedCode = null;
        session.resolveFinished();
        return;
      }
    }

    session.publicState.phase = "failed";
    session.publicState.message =
      session.publicState.provider === "codex" &&
      /403|forbidden|device(?: code)? (?:login )?(?:is )?disabled/iu.test(
        session.output,
      )
        ? "ChatGPT device code login is disabled for this account."
        : `${status.displayName} login did not complete.`;
    session.submittedCode = null;
    session.resolveFinished();
  }
}

export const providerAuthManager = new ProviderAuthManager();
