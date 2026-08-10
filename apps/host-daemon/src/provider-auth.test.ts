import { describe, expect, it } from "vitest";
import {
  ProviderAuthManager,
  type ProviderAuthProcess,
  type ProviderAuthProcessSpawner,
} from "./provider-auth.js";
import type {
  ProviderCliCommandResult,
  ProviderCliCommandRunner,
  RunProviderCliCommandArgs,
} from "./provider-cli-health.js";

function result(
  args: RunProviderCliCommandArgs,
  stdout: string,
  exitCode = 0,
): ProviderCliCommandResult {
  return {
    command: args.command,
    args: args.args,
    stdout,
    stderr: "",
    exitCode,
    signal: null,
    errorMessage: null,
  };
}

class FakeProcess implements ProviderAuthProcess {
  private dataListener: (data: string) => void = () => {};
  private exitListener: (exitCode: number) => void = () => {};
  readonly writes: string[] = [];
  onWrite: (data: string) => void = () => {};

  onData(listener: (data: string) => void): void {
    this.dataListener = listener;
  }
  onExit(listener: (exitCode: number) => void): void {
    this.exitListener = listener;
  }
  write(data: string): void {
    this.writes.push(data);
    this.onWrite(data);
  }
  kill(): void {}
  emitData(data: string): void {
    this.dataListener(data);
  }
  emitExit(exitCode = 0): void {
    this.exitListener(exitCode);
  }
}

function spawnerFor(process: FakeProcess, initialOutput: string) {
  return {
    spawn() {
      setTimeout(() => process.emitData(initialOutput), 0);
      return process;
    },
  } satisfies ProviderAuthProcessSpawner;
}

function createRunner(args: {
  claudeLoggedIn: () => boolean;
  doctorOutput?: string;
}): ProviderCliCommandRunner {
  return {
    async run(command) {
      if (command.command === "claude" && command.args[0] === "auth") {
        return result(
          command,
          JSON.stringify({
            loggedIn: args.claudeLoggedIn(),
            authMethod: "claude.ai",
            email: "person@example.com",
            orgName: "Example",
          }),
        );
      }
      if (command.command === "claude" && command.args[0] === "doctor") {
        return result(command, args.doctorOutput ?? "Everything looks good");
      }
      return result(command, "Not logged in", 1);
    },
  };
}

const missingCodexCredentials = async () => {
  throw new Error("missing");
};

describe("ProviderAuthManager", () => {
  it("forwards a Claude one-time code unchanged and verifies success", async () => {
    let loggedIn = false;
    const process = new FakeProcess();
    process.onWrite = () => {
      loggedIn = true;
      setTimeout(() => process.emitExit(), 0);
    };
    const manager = new ProviderAuthManager({
      processSpawner: spawnerFor(
        process,
        "Open https://claude.ai/oauth/authorize?state=abc\n",
      ),
      runnerFactory: () => createRunner({ claudeLoggedIn: () => loggedIn }),
      readCodexCredentials: missingCodexCredentials,
      createId: () => "session-1",
    });

    const started = await manager.start("claudeCode", {});
    expect(started.sessions[0]?.phase).toBe("waitingForCode");
    expect(started.sessions[0]?.oauthUrl).toContain("claude.ai");

    const code = "  exact-code  ";
    const completed = await manager.submitCode("session-1", code, {});
    expect(process.writes).toEqual([`${code}\r`]);
    expect(completed.statuses.claudeCode.accountEmail).toBe(
      "person@example.com",
    );
    expect(completed.sessions[0]?.phase).toBe("succeeded");
  });

  it("shows the local keychain recovery command after false success", async () => {
    const process = new FakeProcess();
    process.onWrite = () => {
      process.emitData("Login successful\n");
      setTimeout(() => process.emitExit(), 0);
    };
    const manager = new ProviderAuthManager({
      processSpawner: spawnerFor(process, "https://claude.ai/oauth/test\n"),
      runnerFactory: () =>
        createRunner({
          claudeLoggedIn: () => false,
          doctorOutput: "macOS Keychain is not writable",
        }),
      readCodexCredentials: missingCodexCredentials,
      createId: () => "session-2",
      nodePlatform: "darwin",
    });

    await manager.start("claudeCode", {});
    const completed = await manager.submitCode("session-2", "code", {});
    expect(completed.sessions[0]).toMatchObject({
      phase: "recoveryRequired",
      recoveryCommand:
        "security unlock-keychain ~/Library/Keychains/login.keychain-db",
    });
  });

  it("reads a Codex device URL and one-time code", async () => {
    const process = new FakeProcess();
    const manager = new ProviderAuthManager({
      processSpawner: spawnerFor(
        process,
        "Open https://auth.openai.com/codex/device and enter ABCD-EFGH\n",
      ),
      runnerFactory: () => createRunner({ claudeLoggedIn: () => true }),
      readCodexCredentials: missingCodexCredentials,
      createId: () => "session-3",
    });

    const started = await manager.start("codex", {});
    expect(started.sessions[0]).toMatchObject({
      phase: "waitingForUser",
      oauthUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
    });
  });
});
