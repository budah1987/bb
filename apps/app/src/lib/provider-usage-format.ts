export function formatProviderUsageReset(
  resetsAt: string | null,
  nowMs: number = Date.now(),
): string | null {
  if (!resetsAt) return null;

  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return null;

  const diffMs = reset.getTime() - nowMs;
  if (diffMs <= 0) return "Resetting now";

  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes < 60) return `Resets in ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    const minutes = diffMinutes % 60;
    return minutes > 0
      ? `Resets in ${diffHours} hr ${minutes} min`
      : `Resets in ${diffHours} hr`;
  }

  const withinWeek = diffMs < 7 * 24 * 60 * 60_000;
  const formatted = reset.toLocaleString(undefined, {
    weekday: withinWeek ? "short" : undefined,
    month: withinWeek ? undefined : "short",
    day: withinWeek ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Resets ${formatted}`;
}
