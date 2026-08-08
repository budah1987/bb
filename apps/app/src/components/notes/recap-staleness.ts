export interface RecapStalenessInput {
  /** Thread event sequence the stored recap reflects; null when never generated. */
  recapSourceSeq: number | null;
  /**
   * The thread's current high-water event sequence, or null while it is still
   * unknown (outline not loaded). Unknown is treated as "cannot claim stale",
   * never as "current".
   */
  currentSeq: number | null;
}

export type RecapStaleness =
  /** The recap reflects the thread's latest sequence. */
  | { kind: "current" }
  /** The thread moved on; the recap describes an older state. */
  | { kind: "stale" }
  /** Not enough information to judge — render neutrally, claim nothing. */
  | { kind: "unknown" };

/**
 * Whether a stored recap still describes the thread. A recap is only ever
 * presented as current when both sequences are known and equal: an unknown
 * current sequence resolves to `unknown`, never to `current`, so a slow or
 * failed outline load can never dress a stale recap up as fresh.
 *
 * A `currentSeq` *behind* `recapSourceSeq` is also `current` — that ordering
 * means a client window is lagging the recap, not that the recap is old.
 */
export function resolveRecapStaleness({
  recapSourceSeq,
  currentSeq,
}: RecapStalenessInput): RecapStaleness {
  if (recapSourceSeq === null || currentSeq === null) {
    return { kind: "unknown" };
  }
  return currentSeq > recapSourceSeq ? { kind: "stale" } : { kind: "current" };
}
