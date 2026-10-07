import type { Clause, CompileResult, ExtractedPolicy, Policy } from "./types";

/** Known venues, by the names a person would actually type. */
export const VENUES: Record<string, { address: string; label: string }> = {
  kuru: { address: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394", label: "Kuru MON-USDC" },
};

export const ASSETS: Record<string, { address: string; decimals: number; native?: boolean }> = {
  usdc: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6 },
  mon: { address: "0x0000000000000000000000000000000000000000", decimals: 18, native: true },
};

const UNIT_SECONDS: Record<string, number> = {
  hour: 3600,
  day: 86400,
  week: 604800,
  month: 2592000, // 30 days; a calendar month is not a fixed window length
};

/**
 * Phrases we refuse outright, with the reason the recipient is shown.
 *
 * These are not a safety net over the model — the contract refuses all of them
 * on its own. They exist so a person finds out at compose time, in a sentence,
 * instead of watching a transaction revert later and not knowing why.
 */
const REFUSALS: { match: RegExp; because: string; blocking: boolean }[] = [
  {
    match: /\b(limit orders?|resting orders?|post.?only|good.?til|gtc)\b/i,
    because:
      "A resting order fills in a later transaction, so the proceeds could not reach the beneficiary in the same transaction as the trade. Only immediate fills are expressible.",
    blocking: true,
  },
  {
    match: /\b(margins?|leverage|leveraged|borrow|shorts?|perps?|perpetuals?)\b/i,
    because:
      "Trades settle directly, with no margin account, so the capsule never takes on a position it cannot close from its own balance.",
    blocking: true,
  },
  {
    match: /\b(unlimited|whatever it takes|no limit|as much as|any amount)\b/i,
    because: "A capsule without a ceiling is not a capsule. Every permission carries a hard cap set at mint.",
    blocking: true,
  },
  {
    match: /\b(ignore|override|bypass|exceed|lift)\b.{0,24}\b(cap|limit|ceiling)\b/i,
    because:
      "Nothing lifts the hard cap — not an escalation, not the issuer, not a compromised backend. An agent may ask to exceed the soft caps; it can never pass this one.",
    blocking: true,
  },
  {
    match: /\b(withdraw|transfer out|send to my|cash out|move the funds)\b/i,
    because:
      "A capsule spends at an allowlisted venue and pays a beneficiary fixed at mint. It cannot move funds to an arbitrary address.",
    blocking: true,
  },
  {
    match: /\b(cross.?chain|bridge|another chain|other chains?)\b/i,
    because: "A capsule governs one vault on one chain. Bridging is outside what it can enforce.",
    blocking: true,
  },
  {
    match: /\b(let the agent decide|agent decides|at its discretion|as it sees fit)\b/i,
    because:
      "The amount, the venue and the destination are fixed at mint. Discretion over those is the thing being removed.",
    blocking: true,
  },
];

/**
 * Phrases we accept but cannot enforce. The agent is told; nothing makes it
 * obey, and saying so plainly is the point.
 */
const ADVISORIES: { match: RegExp; because: string }[] = [
  {
    match: /\b(dips?|cheap|low prices?|below|under \$|when the price)\b/i,
    because: "No price oracle is consulted on chain, so a condition on price is an instruction to the agent, not a limit.",
  },
  { match: /\b(mornings?|evenings?|nights?|weekdays?|weekends?|mondays?|fridays?)\b/i, because: "The chain checks the window, not the hour you prefer within it." },
  { match: /\b(gradually|slowly|carefully|aggressively|dca|average)\b/i, because: "A style of execution. The caps bound the size; nothing bounds the manner." },
  { match: /\b(prefer|try to|ideally|if possible|where you can)\b/i, because: "Stated as a preference, so it is passed to the agent as one." },
];

function parseAmountToUnits(value: number, assetKey: string): bigint {
  const asset = ASSETS[assetKey.toLowerCase()];
  if (!asset) throw new Error(`unknown asset: ${assetKey}`);
  // avoid float drift on things like 0.05 by going through a fixed string
  const [whole, frac = ""] = value.toFixed(asset.decimals).split(".");
  return BigInt(whole + frac.padEnd(asset.decimals, "0"));
}

/**
 * Turn an extraction into a policy, and classify every clause on the way.
 *
 * Deliberately rule-based. Which clauses the chain can enforce is a fact about
 * Valet.sol — the nineteen asserts and the fields a capsule stores — not a
 * judgement to delegate. The model's only job is language into structure; if it
 * were also deciding the verdicts, the three buckets a recipient is shown would
 * be a model's opinion rather than a description of what will happen.
 */
export function compile(
  source: string,
  extracted: ExtractedPolicy,
  now: number = Math.floor(Date.now() / 1000),
): CompileResult {
  const clauses: Clause[] = [];
  const blockers: string[] = [];
  const advisory: string[] = [];

  // --- refusals first: a blocking one means nothing should mint ------------
  for (const rule of REFUSALS) {
    const hit = source.match(rule.match);
    if (!hit) continue;
    clauses.push({ text: hit[0], verdict: "refused", because: rule.because });
    if (rule.blocking) blockers.push(rule.because);
  }

  // --- advisories ---------------------------------------------------------
  for (const rule of ADVISORIES) {
    const hit = source.match(rule.match);
    if (!hit) continue;
    clauses.push({ text: hit[0], verdict: "advisory", because: rule.because });
    advisory.push(hit[0]);
  }
  for (const u of extracted.unmapped ?? []) {
    clauses.push({
      text: u,
      verdict: "advisory",
      because: "No capsule field carries this, so it is passed to the agent as an instruction.",
    });
    advisory.push(u);
  }

  // --- enforced -----------------------------------------------------------
  const missing: string[] = [];
  if (!extracted.amountPerAction) missing.push("an amount per action");
  if (!extracted.cadence) missing.push("how often");
  if (!extracted.periods) missing.push("for how many periods");
  if (!extracted.buyAsset) missing.push("what to buy");
  if (missing.length) {
    blockers.push(`The policy is missing ${missing.join(", ")}.`);
    return { ok: false, clauses, blockers };
  }

  const amt = extracted.amountPerAction!;
  const assetInKey = amt.asset.toLowerCase();
  const assetOutKey = extracted.buyAsset!.toLowerCase();
  if (!ASSETS[assetInKey]) blockers.push(`Unknown asset to spend: ${amt.asset}.`);
  if (!ASSETS[assetOutKey]) blockers.push(`Unknown asset to buy: ${extracted.buyAsset}.`);
  if (assetInKey === assetOutKey) blockers.push("Spending and buying the same asset would be a no-op.");

  const windowLength = UNIT_SECONDS[extracted.cadence!.unit] * extracted.cadence!.every;
  const perAction = parseAmountToUnits(amt.value, assetInKey);
  const periods = extracted.periods!;
  const totalCap = perAction * BigInt(periods);

  // The hard cap is the one bound a person should set consciously. Absent an
  // explicit ceiling we take twice the per-action amount: enough headroom for a
  // genuine escalation, nowhere near enough to matter if the agent is wrong.
  const hardCap = extracted.hardCeiling
    ? parseAmountToUnits(extracted.hardCeiling.value, extracted.hardCeiling.asset.toLowerCase())
    : perAction * 2n;
  if (hardCap < perAction) blockers.push("The ceiling is below the per-action amount.");
  if (hardCap > totalCap) blockers.push("The ceiling is above the lifetime total, which cannot be right.");

  const slippagePct = extracted.maxSlippagePercent ?? 1;
  if (slippagePct <= 0 || slippagePct > 100) blockers.push(`A slippage bound of ${slippagePct}% is not usable.`);
  const maxSlippageBps = Math.round(slippagePct * 100);

  const venueKeys = (extracted.venues?.length ? extracted.venues : ["kuru"]).map((v) => v.toLowerCase());
  const allowedTargets: string[] = [];
  for (const v of venueKeys) {
    if (!VENUES[v]) blockers.push(`Unknown venue: ${v}.`);
    else allowedTargets.push(VENUES[v].address);
  }

  const notBefore = extracted.startAt ? Math.floor(new Date(extracted.startAt).getTime() / 1000) : now;
  if (Number.isNaN(notBefore)) blockers.push(`Could not read a start time from "${extracted.startAt}".`);
  const expiresAt = notBefore + windowLength * periods;

  const ben = extracted.beneficiary ?? { kind: "principal" as const };
  const beneficiaryMode = ben.kind === "vault" ? 0 : ben.kind === "principal" ? 1 : 2;
  if (beneficiaryMode === 2 && !ben.label) blockers.push("A fixed beneficiary needs an address.");

  // Clause text is read by a person deciding whether to accept a permission, so
  // it is written as English rather than as a field dump. "every 1 day" and
  // "30 periods" were both correct and both things nobody says.
  const UNIT = amt.asset.toUpperCase();
  const every = extracted.cadence!.every;
  const unit = extracted.cadence!.unit;
  const howOften =
    every === 1
      ? { hour: "every hour", day: "once a day", week: "once a week", month: "once a month" }[unit]
      : `once every ${every} ${unit}s`;
  const forHowLong = `${periods} ${unit}${periods === 1 ? "" : "s"}`;
  const WHERE = { vault: "back into the vault", principal: "to the recipient", fixed: "to one fixed address" }[ben.kind];

  clauses.push(
    { text: `spends at most ${amt.value} ${UNIT} at a time`, verdict: "enforced", boundTo: "bounds.perAction", because: "Checked on every spend. A larger request is refused as OVER_ACTION_CAP." },
    { text: `${howOften}, and no more often`, verdict: "enforced", boundTo: "bounds.windowLength", because: "One window per period. An unused window is forfeited, not banked — a skipped day cannot be spent later." },
    { text: `for ${forHowLong}, then it stops`, verdict: "enforced", boundTo: "bounds.windows", because: "After the last window the capsule refuses everything as WINDOWS_EXHAUSTED." },
    { text: `buys ${extracted.buyAsset!.toUpperCase()} and nothing else`, verdict: "enforced", boundTo: "assetOut", because: "Fixed at mint. The agent chooses the venue, never the asset." },
    { text: `accepts no fill worse than ${slippagePct}%`, verdict: "enforced", boundTo: "bounds.maxSlippageBps", because: "The floor the agent commits to must sit inside this, and the measured fill must clear that floor." },
    { text: `never more than ${formatUnits(hardCap, ASSETS[assetInKey].decimals)} ${UNIT} in one go, whatever anyone approves`, verdict: "enforced", boundTo: "bounds.hardCap", because: "Nothing lifts this. Not an escalation, not the issuer, not a compromised backend." },
    { text: `${formatUnits(totalCap, ASSETS[assetInKey].decimals)} ${UNIT} in total, ever`, verdict: "enforced", boundTo: "bounds.totalCap", because: "The most that can ever move through this capsule." },
    { text: `trades on ${venueKeys.map((v) => VENUES[v]?.label ?? v).join(" or ")} only`, verdict: "enforced", boundTo: "allowedTargets", because: "Any other venue is refused as TARGET_NOT_ALLOWED, whatever calldata the agent supplies." },
    { text: `sends the proceeds ${WHERE}`, verdict: "enforced", boundTo: "beneficiaryMode", because: "Checked against the request on every spend, so the agent cannot pay itself." },
  );

  if (blockers.length) return { ok: false, clauses, blockers };

  const policy: Policy = {
    version: 1,
    source,
    clauses,
    bounds: {
      perAction: perAction.toString(),
      perWindow: perAction.toString(),
      hardCap: hardCap.toString(),
      totalCap: totalCap.toString(),
      windows: periods,
      windowLength,
      notBefore,
      expiresAt,
      maxSlippageBps,
    },
    assetIn: ASSETS[assetInKey].address,
    assetOut: ASSETS[assetOutKey].address,
    beneficiaryMode: beneficiaryMode as 0 | 1 | 2,
    fixedBeneficiary: beneficiaryMode === 2 ? ben.label! : "0x0000000000000000000000000000000000000000",
    allowedTargets,
    advisory,
  };

  return { ok: true, policy, clauses, blockers: [] };
}

function formatUnits(v: bigint, decimals: number): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
