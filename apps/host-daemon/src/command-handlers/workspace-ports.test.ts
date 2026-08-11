import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  findAvailableWorkspacePort,
  readWorkspacePortStatus,
} from "./workspace-ports.js";

const servers: net.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function listen(): Promise<{ port: number; server: net.Server }> {
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen({ host: "127.0.0.1", port: 0 }, () => resolve()),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP address");
  }
  return { port: address.port, server };
}

describe("workspace ports", () => {
  it("selects the next port when the preferred port is occupied", async () => {
    const occupied = await listen();

    const result = await findAvailableWorkspacePort({
      candidateCount: 10,
      preferredPort: occupied.port,
    });

    expect(result.port).toBeGreaterThan(occupied.port);
  });

  it("reports whether a loopback port accepts connections", async () => {
    const listening = await listen();
    const available = await findAvailableWorkspacePort({
      candidateCount: 100,
      preferredPort: 30_000,
    });

    await expect(readWorkspacePortStatus(listening.port)).resolves.toEqual({
      isListening: true,
    });
    await expect(readWorkspacePortStatus(available.port)).resolves.toEqual({
      isListening: false,
    });
  });
});
