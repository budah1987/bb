import type { CSSProperties } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { conversationSignal, type ConversationSignal } from "./thread-state";

const CELLS = Array.from({ length: 25 }, (_, index) => index);

export function PixelMatrix({
  signal,
  label,
}: {
  signal: ConversationSignal;
  label?: string | null;
}) {
  const accessibleLabel =
    label ??
    (signal === "passive"
      ? null
      : `${signal[0]?.toUpperCase()}${signal.slice(1)} conversation`);
  return (
    <span
      className={`conductor-signal-slot conductor-pixel-matrix conductor-pixel-matrix--${signal}`}
      {...(accessibleLabel
        ? { role: "img", "aria-label": accessibleLabel }
        : { "aria-hidden": true })}
    >
      {CELLS.map((index) => (
        <span
          key={index}
          className="conductor-pixel"
          style={
            {
              "--pixel-phase": (index % 5) + Math.floor(index / 5),
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

export function ThreadPixelMatrix({ thread }: { thread: PluginSidebarThread }) {
  return (
    <PixelMatrix
      signal={conversationSignal(thread)}
      label={thread.indicatorLabel}
    />
  );
}
