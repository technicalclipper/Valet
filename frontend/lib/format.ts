/**
 * Humanising the chain's numbers.
 *
 * A capsule stores 5000000, 86400 and 1791391062. Those are correct and
 * unreadable, and showing them to the person being handed a permission is a
 * failure of nerve dressed up as transparency — the raw values belong behind
 * "show me the proof", not in front of the answer.
 */

export function amount(v: bigint, decimals = 6, unit = "USDC"): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  const n = frac ? `${whole}.${frac}` : whole;
  return unit ? `${n} ${unit}` : n;
}

export function bare(v: bigint, decimals = 6): string {
  return amount(v, decimals, "");
}

/** 86400 -> "a day", 172800 -> "2 days", 604800 -> "a week" */
export function duration(seconds: bigint | number): string {
  const s = Number(seconds);
  const units: [number, string, string][] = [
    [604800, "week", "weeks"],
    [86400, "day", "days"],
    [3600, "hour", "hours"],
    [60, "minute", "minutes"],
  ];
  for (const [size, one, many] of units) {
    if (s % size === 0 && s >= size) {
      const n = s / size;
      return n === 1 ? `a ${one}` : `${n} ${many}`;
    }
  }
  return `${s} seconds`;
}

/** "every a day" reads badly; this gives "daily", "every 2 days" */
export function cadence(seconds: bigint | number): string {
  const s = Number(seconds);
  if (s === 86400) return "daily";
  if (s === 604800) return "weekly";
  if (s === 3600) return "hourly";
  return `every ${duration(s)}`;
}

export function when(unix: bigint | number): string {
  return new Date(Number(unix) * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function shortAddress(a: string): string {
  return a === "0x0000000000000000000000000000000000000000"
    ? "none"
    : `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function percent(bps: number): string {
  return `${bps / 100}%`;
}

/** 0 -> "back to the vault" */
export const BENEFICIARY = ["back into the vault", "to the recipient", "to a fixed address"] as const;

/**
 * Readable names for the nineteen asserts.
 *
 * Nineteen anonymous dots in a row say "there are checks" and nothing else. A
 * name per light is the difference between decoration and evidence, and these
 * are phrased as the thing being confirmed rather than the thing that failed —
 * a green light should read as a sentence that is true.
 */
export const ASSERT_LABEL: Record<string, string> = {
  VAULT_MISMATCH: "the vault matches this capsule",
  NOT_CLAIMED: "someone has claimed it",
  NOT_HOLDER: "the caller is the holder",
  VAULT_REVOKED: "the vault is not revoked",
  CAPSULE_REVOKED: "the capsule is not revoked",
  SURRENDERED: "it has not been handed back",
  PAUSED: "neither party has paused it",
  BEFORE_START: "the term has started",
  EXPIRED: "the term has not ended",
  WINDOWS_EXHAUSTED: "windows remain",
  ZERO_AMOUNT: "the amount is not zero",
  OVER_ACTION_CAP: "within the per-action cap",
  OVER_WINDOW_CAP: "within this window's cap",
  OVER_HARD_CAP: "under the hard cap",
  OVER_TOTAL_CAP: "under the lifetime cap",
  TARGET_NOT_ALLOWED: "the venue is allowlisted",
  SLIPPAGE_TOO_WIDE: "the floor is inside the slippage bound",
  WRONG_RECIPIENT: "proceeds go to the beneficiary",
  VAULT_UNDERFUNDED: "the vault has the balance",
};
