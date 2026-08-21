import { readdirSync } from "node:fs";
import { spawn as spawnPty } from "node-pty";
import { expect, it } from "vitest";

function openFileDescriptorCount(): number {
  return readdirSync("/dev/fd").length;
}

async function spawnAndExitPty(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const terminal = spawnPty("/bin/sh", ["-c", "exit 0"], {
      cols: 80,
      name: "xterm-256color",
      rows: 24,
    });
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for PTY to exit"));
    }, 5_000);
    terminal.onExit(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

const itOnMac = process.platform === "darwin" ? it : it.skip;

itOnMac("releases native descriptors after repeated PTY exits", async () => {
  const before = openFileDescriptorCount();

  for (let attempt = 0; attempt < 24; attempt += 1) {
    await spawnAndExitPty();
  }

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(openFileDescriptorCount()).toBeLessThanOrEqual(before + 4);
});
