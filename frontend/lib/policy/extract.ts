import type { ExtractedPolicy } from "./types";

/**
 * Language into structure. Verdicts are not this layer's business — `compile`
 * decides those from the contract's actual capabilities.
 */
export interface Extractor {
  (source: string): Promise<ExtractedPolicy>;
}

const UNITS: Record<string, "hour" | "day" | "week" | "month"> = {
  hour: "hour", hourly: "hour", hours: "hour",
  day: "day", daily: "day", days: "day",
  week: "week", weekly: "week", weeks: "week",
  month: "month", monthly: "month", months: "month",
};

/**
 * Handles the phrasings a person actually types, with no network call.
 *
 * This exists so the demo cannot be broken by an API being slow or down, and so
 * the common path is reproducible to the byte — the policy hash a recipient
 * verifies should not depend on a model's sampling. The LLM extractor is for the
 * long tail; this is for the sentence in the pitch.
 */
export const extractWithRules: Extractor = async (source) => {
  const s = source.toLowerCase();
  const out: ExtractedPolicy = {};

  // "5 USDC of MON", "spend 0.05 usdc", "buy 5 usdc worth of mon"
  const amount = s.match(/(\d+(?:\.\d+)?)\s*(usdc|mon)\b/);
  if (amount) out.amountPerAction = { value: Number(amount[1]), asset: amount[2] };

  // "of MON", "buy MON", "into MON"
  const buy = s.match(/(?:of|buy|into|get)\s+(mon|usdc)\b/);
  if (buy && buy[1] !== amount?.[2]) out.buyAsset = buy[1];
  else if (amount?.[2] === "usdc") out.buyAsset = "mon";

  // "daily", "every 2 days", "weekly"
  const everyN = s.match(/every\s+(\d+)\s+(hours?|days?|weeks?|months?)/);
  if (everyN) out.cadence = { every: Number(everyN[1]), unit: UNITS[everyN[2]] };
  else {
    const bare = s.match(/\b(hourly|daily|weekly|monthly)\b/);
    if (bare) out.cadence = { every: 1, unit: UNITS[bare[1]] };
  }

  // "for 30 days", "for 12 weeks", "30 times"
  const forN = s.match(/for\s+(\d+)\s+(hours?|days?|weeks?|months?)/);
  if (forN && out.cadence) {
    const unit = UNITS[forN[2]];
    out.periods = unit === out.cadence.unit ? Number(forN[1]) : Number(forN[1]);
  } else {
    const times = s.match(/(\d+)\s*(?:times|periods|occurrences)/);
    if (times) out.periods = Number(times[1]);
  }

  // "max 1% slippage", "1 percent slippage"
  const slip = s.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:max\s*)?slippage|slippage\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  if (slip) out.maxSlippagePercent = Number(slip[1] ?? slip[2]);

  // "ceiling of 10 USDC", "hard cap 10 usdc", "never more than 10 usdc"
  const ceil = s.match(/(?:ceiling|hard cap|never more than|at most)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(usdc|mon)/);
  if (ceil) out.hardCeiling = { value: Number(ceil[1]), asset: ceil[2] };

  // where the proceeds go, and to whom
  if (/\b(keep|back to|into) the vault\b/.test(s)) out.beneficiary = { kind: "vault" };
  else out.beneficiary = { kind: "principal" };

  // The original sentence is matched, not the lowercased one, so an address
  // keeps its checksum casing for display. Lowercased later, where it is hashed.
  const email = source.match(/\bto\s+([^\s@,;]+@[^\s@,;]+\.[a-z]{2,24})\b/i);
  const addr = source.match(/\bto\s+(0x[0-9a-fA-F]{40})\b/);
  if (email) out.recipientHint = { kind: "email", value: email[1].toLowerCase() };
  else if (addr) out.recipientHint = { kind: "address", value: addr[1] };
  else {
    // "send the MON to bob" — a name the sentence gives and nothing can resolve
    const name = source.match(/\b(?:send|give|pay)\b[^.]*?\bto\s+([A-Za-z][\w'-]{1,30})\b(?![^.]*@)/i);
    if (name && !/^(the|my|me|a|an|kuru|vault|this|that)$/i.test(name[1])) out.nameHint = name[1];
  }

  if (/\bkuru\b/.test(s)) out.venues = ["kuru"];

  return out;
};
