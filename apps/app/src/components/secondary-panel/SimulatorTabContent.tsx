import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  SimulatorControlAction,
  SimulatorStreamConnection,
} from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { sdk } from "@/lib/sdk";
import { useEnvironmentSimulatorStatus } from "@/hooks/queries/environment-queries";
import { invalidateEnvironmentSimulatorStatus } from "@/hooks/cache-owners/simulator-cache-owner";
import { MjpegFrameBuffer } from "./mjpeg-frame-buffer";
import { SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS } from "./panelChromeClasses";

interface SimulatorTabContentProps {
  environmentId: string;
  isActive: boolean;
}

interface NormalizedPoint {
  x: number;
  y: number;
}

interface DragState {
  bounds: Pick<DOMRect, "height" | "left" | "top" | "width">;
  points: NormalizedPoint[];
  pointerId: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Simulator request failed.";
}

function useMjpegFrame(
  stream: SimulatorStreamConnection,
  onFrame: (url: string) => void,
): { disconnected: boolean; hasFrame: boolean } {
  const [disconnected, setDisconnected] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const hasFrameRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let currentUrl: string | null = null;
    void (async () => {
      try {
        const response = await fetch(stream.url, {
          credentials: "include",
          headers: { Authorization: `Bearer ${stream.token}` },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error(`Simulator stream returned HTTP ${response.status}.`);
        }
        setDisconnected(false);
        const reader = response.body.getReader();
        const buffer = new MjpegFrameBuffer();
        while (!controller.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const frame = buffer.push(chunk.value).at(-1);
          if (frame === undefined) continue;

          const nextUrl = URL.createObjectURL(
            new Blob([frame], { type: "image/jpeg" }),
          );
          onFrame(nextUrl);
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          currentUrl = nextUrl;
          if (!hasFrameRef.current) {
            hasFrameRef.current = true;
            setHasFrame(true);
          }
        }
        if (!controller.signal.aborted) setDisconnected(true);
      } catch {
        if (!controller.signal.aborted) setDisconnected(true);
      }
    })();
    return () => {
      controller.abort();
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [onFrame, stream]);

  return { disconnected, hasFrame };
}

function SimulatorStreamImage({
  onDisconnectedChange,
  stream,
}: {
  onDisconnectedChange: (disconnected: boolean) => void;
  stream: SimulatorStreamConnection;
}) {
  const imageRef = useRef<HTMLImageElement>(null);
  const applyFrame = useCallback((url: string) => {
    if (imageRef.current) imageRef.current.src = url;
  }, []);
  const { disconnected, hasFrame } = useMjpegFrame(stream, applyFrame);

  useEffect(() => {
    onDisconnectedChange(disconnected);
  }, [disconnected, onDisconnectedChange]);

  return (
    <>
      <img
        ref={imageRef}
        alt=""
        draggable={false}
        className={cn("size-full object-contain", !hasFrame && "invisible")}
      />
      {!hasFrame ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/70">
          <Icon name="Spinner" className="size-4 animate-spin" />
          Connecting…
        </div>
      ) : null}
      {disconnected ? (
        <div className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-background/90 px-2 py-1 text-xs shadow">
          Reconnecting…
        </div>
      ) : null}
    </>
  );
}

function normalizedPoint(
  event: PointerEvent<HTMLElement>,
  bounds: Pick<DOMRect, "height" | "left" | "top" | "width">,
): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

export function SimulatorTabContent({
  environmentId,
  isActive,
}: SimulatorTabContentProps) {
  const queryClient = useQueryClient();
  const status = useEnvironmentSimulatorStatus(environmentId);
  const [selectedDevice, setSelectedDevice] = useState(
    () =>
      window.localStorage.getItem(`bb.simulator.lastDevice.${environmentId}`) ??
      "",
  );
  const [stream, setStream] = useState<SimulatorStreamConnection | null>(null);
  const [attachCancelled, setAttachCancelled] = useState(false);
  const [orientation, setOrientation] = useState<"portrait" | "landscape_left">(
    "portrait",
  );
  const [disconnected, setDisconnected] = useState(false);
  const dragRef = useRef<DragState | null>(null);

  const refreshStatus = useCallback(async () => {
    await invalidateEnvironmentSimulatorStatus({
      environmentId,
      queryClient,
    });
  }, [environmentId, queryClient]);

  const attach = useMutation({
    mutationFn: (deviceUdid: string | undefined) =>
      sdk.environments.simulatorAttach({
        environmentId,
        ...(deviceUdid ? { deviceUdid } : {}),
      }),
    onSuccess: async (result) => {
      setAttachCancelled(false);
      setStream(result.stream);
      setSelectedDevice(result.session.deviceUdid);
      await refreshStatus();
    },
  });
  const lease = useMutation({
    mutationFn: () => sdk.environments.simulatorLease({ environmentId }),
    onSuccess: setStream,
  });
  const control = useMutation({
    mutationFn: (action: SimulatorControlAction) =>
      sdk.environments.simulatorControl({ environmentId, action }),
  });
  const stop = useMutation({
    mutationFn: () => sdk.environments.simulatorStop({ environmentId }),
    onSuccess: async () => {
      setStream(null);
      await refreshStatus();
    },
  });

  const activeSession = status.data?.active ?? null;
  const requestLease = lease.mutate;
  const isLeasePending = lease.isPending;
  const effectiveSelectedDevice = status.data?.devices.some(
    (device) => device.udid === selectedDevice,
  )
    ? selectedDevice
    : (status.data?.devices[0]?.udid ?? "");

  useEffect(() => {
    if (!activeSession || stream || isLeasePending) return;
    requestLease();
  }, [activeSession, isLeasePending, requestLease, stream]);

  useEffect(() => {
    if (!stream) return;
    const delay = Math.max(1_000, stream.expiresAt - Date.now() - 30_000);
    const timer = window.setTimeout(() => requestLease(), delay);
    return () => window.clearTimeout(timer);
  }, [requestLease, stream]);

  const mutationError =
    (attachCancelled ? null : attach.error) ??
    lease.error ??
    control.error ??
    stop.error;

  const sendControl = useCallback(
    (action: SimulatorControlAction) => control.mutate(action),
    [control],
  );
  const handlePointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      bounds,
      pointerId: event.pointerId,
      points: [normalizedPoint(event, bounds)],
    };
  }, []);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = normalizedPoint(event, drag.bounds);
    const previous = drag.points.at(-1);
    if (
      !previous ||
      Math.hypot(point.x - previous.x, point.y - previous.y) > 0.01
    ) {
      drag.points.push(point);
    }
  }, []);
  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const end = normalizedPoint(event, drag.bounds);
      const start = drag.points[0] ?? end;
      if (Math.hypot(end.x - start.x, end.y - start.y) < 0.02) {
        sendControl({ kind: "tap", ...end });
        return;
      }
      const middle = drag.points.slice(1).map((point) => ({
        type: "move" as const,
        ...point,
      }));
      sendControl({
        kind: "gesture",
        points: [
          { type: "begin", ...start },
          ...middle,
          { type: "end", ...end },
        ],
      });
    },
    [sendControl],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.currentTarget.blur();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const text =
        event.key === "Enter"
          ? "\n"
          : event.key.length === 1
            ? event.key
            : null;
      if (text !== null) {
        event.preventDefault();
        sendControl({ kind: "type", text });
      }
    },
    [sendControl],
  );
  const handleWheel = useCallback(
    (event: WheelEvent<HTMLElement>) => {
      event.preventDefault();
      const direction = Math.sign(event.deltaY);
      if (direction === 0) return;
      const startY = direction > 0 ? 0.35 : 0.65;
      const endY = direction > 0 ? 0.65 : 0.35;
      sendControl({
        kind: "gesture",
        points: [
          { type: "begin", x: 0.5, y: startY },
          { type: "end", x: 0.5, y: endY },
        ],
      });
    },
    [sendControl],
  );

  if (status.isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Icon name="Spinner" className="size-4 animate-spin" />
        Checking simulator support…
      </div>
    );
  }

  if (status.error || !status.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm">
        <p>{errorMessage(status.error)}</p>
        <Button variant="outline" onClick={() => void status.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!status.data.supported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <Icon name="Smartphone" className="mb-2 size-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          iOS Simulator requires a Mac with Xcode
        </p>
        <p className="text-sm text-muted-foreground">{status.data.message}</p>
      </div>
    );
  }

  if (status.data.devices.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium">No simulator runtimes installed</p>
        <p className="text-sm text-muted-foreground">
          Install a runtime from Xcode ▸ Settings ▸ Components.
        </p>
        <Button variant="outline" onClick={() => void status.refetch()}>
          Check again
        </Button>
      </div>
    );
  }

  if (!activeSession) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4">
          <div>
            <p className="text-sm font-medium">iOS Simulator</p>
            <p className="text-sm text-muted-foreground">
              Choose a device to boot in this environment.
            </p>
          </div>
          <select
            aria-label="Simulator device"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={effectiveSelectedDevice}
            onChange={(event) => {
              setSelectedDevice(event.target.value);
              window.localStorage.setItem(
                `bb.simulator.lastDevice.${environmentId}`,
                event.target.value,
              );
            }}
          >
            {status.data.devices.map((device) => (
              <option key={device.udid} value={device.udid}>
                {device.name} — {device.runtime}
              </option>
            ))}
          </select>
          <Button
            disabled={attach.isPending || !effectiveSelectedDevice}
            onClick={() => {
              setAttachCancelled(false);
              attach.mutate(effectiveSelectedDevice || undefined);
            }}
          >
            {attach.isPending ? "Booting device…" : "Start simulator"}
          </Button>
          {attach.isPending ? (
            <Button
              variant="outline"
              onClick={() => {
                setAttachCancelled(true);
                stop.mutate();
              }}
            >
              Stop
            </Button>
          ) : null}
          {mutationError ? (
            <p className="text-sm text-destructive">
              {errorMessage(mutationError)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div
        className={cn(
          "flex h-10 shrink-0 items-center gap-2 border-b border-border px-2",
          SECONDARY_PANEL_TOP_CHROME_BACKGROUND_CLASS,
        )}
      >
        <div className="min-w-0 flex-1 truncate text-sm">
          {activeSession.deviceName}{" "}
          <span className="text-muted-foreground">
            · {disconnected ? "Reconnecting…" : "Booted"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Home"
          onClick={() => sendControl({ kind: "button", button: "home" })}
        >
          <Icon name="Circle" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Rotate"
          onClick={() => {
            const next =
              orientation === "portrait" ? "landscape_left" : "portrait";
            setOrientation(next);
            sendControl({ kind: "rotate", orientation: next });
          }}
        >
          <Icon name="RotateCcw" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Stop simulator"
          onClick={() => stop.mutate()}
        >
          <Icon name="Square" className="size-4 text-destructive" />
        </Button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3">
        <div
          role="application"
          aria-label={`iOS simulator screen — ${activeSession.deviceName}`}
          aria-description="Press Escape to leave the simulator"
          tabIndex={0}
          className="relative aspect-[9/19.5] h-full max-h-full max-w-full touch-none overflow-hidden rounded-[2rem] border-[6px] border-foreground/85 bg-black shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onKeyDown={handleKeyDown}
          onWheel={handleWheel}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (text) sendControl({ kind: "type", text });
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          {isActive && stream ? (
            <SimulatorStreamImage
              key={`${stream.url}:${stream.token}`}
              stream={stream}
              onDisconnectedChange={setDisconnected}
            />
          ) : (
            <div className="flex size-full items-center justify-center gap-2 text-sm text-white/70">
              <Icon name="Spinner" className="size-4 animate-spin" />
              Connecting…
            </div>
          )}
        </div>
      </div>
      {mutationError ? (
        <div className="border-t border-border px-3 py-2 text-sm text-destructive">
          {errorMessage(mutationError)}
        </div>
      ) : null}
    </div>
  );
}
