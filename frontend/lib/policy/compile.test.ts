import { describe, expect, it } from "vitest";
import { compile, ASSETS, VENUES } from "./compile";
import { canonicalize, policyHash } from "./canonical";
import type { ExtractedPolicy } from "./types";

const NOW = 1_700_000_000;

/** What the extractor would return for the demo sentence. */
const demo: ExtractedPolicy = {
  amountPerAction: { value: 5, asset: "usdc" },
  cadence: { every: 1, unit: "day" },
  periods: 30,
  buyAsset: "mon",
  maxSlippagePercent: 1,
  beneficiary: { kind: "principal" },
  venues: ["kuru"],
};

const SENTENCE = "Buy 5 USDC of MON daily for 30 days, max 1% slippage, send the MON to bob";

describe("the demo sentence", () => {
  it("compiles to the bounds the contract was tested with", () => {
    const r = compile(SENTENCE, demo, NOW);
    expect(r.ok).toBe(true);
    expect(r.policy!.bounds).toEqual({
      perAction: "5000000",
      perWindow: "5000000",
      hardCap: "10000000",
      totalCap: "150000000",
      windows: 30,
      windowLength: 86400,
      notBefore: NOW,
      expiresAt: NOW + 86400 * 30,
      maxSlippageBps: 100,
    });
    expect(r.policy!.assetIn).toBe(ASSETS.usdc.address);
    expect(r.policy!.assetOut).toBe(ASSETS.mon.address);
    expect(r.policy!.allowedTargets).toEqual([VENUES.kuru.address]);
    expect(r.policy!.beneficiaryMode).toBe(1);
  });

  /** Mint re-checks all of this on chain; failing here would fail there. */
  it("satisfies Valet's mint-time bounds validation", () => {
    const b = compile(SENTENCE, demo, NOW).policy!.bounds;
    const n = (s: string) => BigInt(s);
    expect(n(b.hardCap)).toBeGreaterThan(0n);
    expect(n(b.totalCap)).toBeGreaterThan(0n);
    expect(n(b.perAction)).toBeGreaterThan(0n);
    expect(n(b.perAction)).toBeLessThanOrEqual(n(b.hardCap));
    expect(n(b.perWindow)).toBeGreaterThanOrEqual(n(b.perAction));
    expect(n(b.perWindow)).toBeLessThanOrEqual(n(b.totalCap));
    expect(n(b.hardCap)).toBeLessThanOrEqual(n(b.totalCap));
    expect(b.windows).toBeGreaterThan(0);
    expect(b.windowLength).toBeGreaterThan(0);
    expect(b.expiresAt).toBeGreaterThan(b.notBefore);
    expect(b.maxSlippageBps).toBeLessThanOrEqual(10_000);
  });

  it("names every enforced clause against a capsule field", () => {
    const enforced = compile(SENTENCE, demo, NOW).clauses.filter((c) => c.verdict === "enforced");
    expect(enforced.length).toBeGreaterThanOrEqual(9);
    for (const c of enforced) expect(c.boundTo, c.text).toBeTruthy();
  });
});

describe("refusals", () => {
  const cases: [string, RegExp][] = [
    ["Place a limit order for MON at 2.50", /resting order/i],
    ["Buy MON with 3x leverage", /no margin account/i],
    ["Spend whatever it takes to get MON", /not a capsule/i],
    ["Buy 5 USDC of MON daily, and ignore the cap if the price spikes", /nothing lifts the hard cap/i],
    ["Buy MON and withdraw the funds to my other wallet", /beneficiary fixed at mint/i],
    ["Buy MON and bridge it cross-chain to Base", /one vault on one chain/i],
    ["Buy MON daily, let the agent decide how much", /discretion over those/i],
  ];

  for (const [sentence, reason] of cases) {
    it(`refuses: "${sentence.slice(0, 44)}..."`, () => {
      const r = compile(sentence, demo, NOW);
      expect(r.ok).toBe(false);
      expect(r.clauses.some((c) => c.verdict === "refused")).toBe(true);
      expect(r.blockers.join(" ")).toMatch(reason);
    });
  }

  it("blocks the mint rather than silently dropping the clause", () => {
    const r = compile(`${SENTENCE}, with 5x leverage`, demo, NOW);
    expect(r.ok).toBe(false);
    expect(r.policy).toBeUndefined();
  });
});

describe("advisories", () => {
  it("accepts a price condition but will not claim to enforce it", () => {
    const r = compile(`${SENTENCE}, and buy on dips`, demo, NOW);
    expect(r.ok).toBe(true);
    const a = r.clauses.find((c) => c.verdict === "advisory")!;
    expect(a.because).toMatch(/no price oracle/i);
    expect(a.boundTo).toBeUndefined();
    expect(r.policy!.advisory.length).toBeGreaterThan(0);
  });

  it("passes unmapped phrases through as instructions", () => {
    const r = compile(SENTENCE, { ...demo, unmapped: ["avoid thin books"] }, NOW);
    expect(r.policy!.advisory).toContain("avoid thin books");
  });
});

describe("what the compiler refuses to guess", () => {
  it("will not invent a missing amount or cadence", () => {
    const r = compile("Buy some MON at some point", {}, NOW);
    expect(r.ok).toBe(false);
    expect(r.blockers[0]).toMatch(/missing an amount per action, how often, for how many periods, what to buy/);
  });

  it("rejects a ceiling below the per-action amount", () => {
    const r = compile(SENTENCE, { ...demo, hardCeiling: { value: 1, asset: "usdc" } }, NOW);
    expect(r.ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/ceiling is below/);
  });

  it("defaults the hard cap to twice per-action when none is stated", () => {
    const r = compile(SENTENCE, demo, NOW);
    expect(r.policy!.bounds.hardCap).toBe("10000000");
    expect(BigInt(r.policy!.bounds.hardCap)).toBe(BigInt(r.policy!.bounds.perAction) * 2n);
  });

  it("rejects spending and buying the same asset", () => {
    const r = compile(SENTENCE, { ...demo, buyAsset: "usdc" }, NOW);
    expect(r.ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/same asset/);
  });

  it("rejects an unknown venue instead of falling back to a known one", () => {
    const r = compile(SENTENCE, { ...demo, venues: ["someotherdex"] }, NOW);
    expect(r.ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/Unknown venue/);
  });

  it("handles fractional amounts without float drift", () => {
    const r = compile(SENTENCE, { ...demo, amountPerAction: { value: 0.05, asset: "usdc" } }, NOW);
    expect(r.policy!.bounds.perAction).toBe("50000");
  });
});

describe("the hash a recipient checks", () => {
  it("does not depend on key order", () => {
    const a = { z: 1, a: { y: 2, b: [3, 4] } };
    const b = { a: { b: [3, 4], y: 2 }, z: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(policyHash(a)).toBe(policyHash(b));
  });

  it("does depend on array order, which is part of what was agreed", () => {
    expect(policyHash({ t: ["0xA", "0xB"] })).not.toBe(policyHash({ t: ["0xB", "0xA"] }));
  });

  it("changes when any bound changes", () => {
    const base = compile(SENTENCE, demo, NOW).policy!;
    const looser = compile(SENTENCE, { ...demo, maxSlippagePercent: 2 }, NOW).policy!;
    expect(policyHash(base)).not.toBe(policyHash(looser));
  });

  it("is stable across recompiles of the same input", () => {
    const a = compile(SENTENCE, demo, NOW).policy!;
    const b = compile(SENTENCE, demo, NOW).policy!;
    expect(policyHash(a)).toBe(policyHash(b));
  });

  it("is a 32-byte hex string the contract can store", () => {
    const h = policyHash(compile(SENTENCE, demo, NOW).policy!);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
