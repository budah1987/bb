import type { CSSProperties } from "react";
import type { PluginSidebarThread } from "@bb/plugin-sdk/app";
import { conversationSignal, type ConversationSignal } from "./thread-state";

const CELLS = Array.from({ length: 25 }, (_, index) => index);

export function PixelMatrix({
  signal,
  label,
}: {
  signal: ConversationSignal;
  label?: string | null;
}) {
  if (signal === "idle") {
    return <span className="conductor-signal-slot" aria-hidden />;
  }
  const accessibleLabel =
    label ??
    (signal === "activity" ? "Conversation working" : "Unread conversation");
  return (
    <span
      className={`conductor-signal-slot conductor-pixel-matrix conductor-pixel-matrix--${signal}`}
      role="img"
      aria-label={accessibleLabel}
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
