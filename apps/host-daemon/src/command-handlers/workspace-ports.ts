import net from "node:net";

const LOOPBACK_HOST = "127.0.0.1";

function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailableWorkspacePort(args: {
  candidateCount: number;
  preferredPort: number;
}): Promise<{ port: number }> {
  for (let offset = 0; offset < args.candidateCount; offset += 1) {
    const port = args.preferredPort + offset;
    if (port > 65535) break;
    if (await canListen(port)) return { port };
  }
  throw new Error("No available development server port was found");
}

export function readWorkspacePortStatus(port: number): Promise<{
  isListening: boolean;
}> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: LOOPBACK_HOST, port });
    const finish = (isListening: boolean) => {
      socket.destroy();
      resolve({ isListening });
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
