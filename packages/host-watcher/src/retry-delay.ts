const MINIMUM_RETRY_FACTOR = 0.8;

export function jitterRetryDelay(
  delayMs: number,
  random: () => number = Math.random,
): number {
  const factor = MINIMUM_RETRY_FACTOR + random() * (1 - MINIMUM_RETRY_FACTOR);
  return Math.max(1, Math.round(delayMs * factor));
}
