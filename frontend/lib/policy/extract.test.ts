import { describe, expect, it } from "vitest";
import { extractWithRules } from "./extract";
import { compile } from "./compile";
import { policyHash } from "./canonical";

const NOW = 1_700_000_000;

/** English in one end, contract-ready bounds out the other, no network. */
async function end2end(sentence: string) {
  return compile(sentence, await extractWithRules(sentence), NOW);
}

describe("the pitch sentence, end to end", () => {
  const SENTENCE = "Buy 5 USDC of MON daily for 30 days, max 1% slippage, send the MON to bob";

  it("needs no model to reach the right bounds", async () => {
    const r = await end2end(SENTENCE);
    expect(r.ok).toBe(true);
    expect(r.policy!.bounds.perAction).toBe("5000000");
    expect(r.policy!.bounds.windows).toBe(30);
    expect(r.policy!.bounds.windowLength).toBe(86400);
    expect(r.policy!.bounds.maxSlippageBps).toBe(100);
    expect(r.policy!.bounds.totalCap).toBe("150000000");
  });

  it("is reproducible, so the recipient's hash check is not a coin flip", async () => {
    const a = await end2end(SENTENCE);
    const b = await end2end(SENTENCE);
    expect(policyHash(a.policy!)).toBe(policyHash(b.policy!));
  });
});

describe("phrasings a person would actually type", () => {
  it("every 2 days", async () => {
    const r = await end2end("spend 2 USDC on MON every 2 days for 10 days, 0.5% slippage");
    expect(r.policy!.bounds.windowLength).toBe(172800);
    expect(r.policy!.bounds.perAction).toBe("2000000");
    expect(r.policy!.bounds.maxSlippageBps).toBe(50);
  });

  it("weekly, with an explicit ceiling", async () => {
    const r = await end2end("buy 10 USDC of MON weekly for 12 weeks, hard cap 15 USDC, 1% slippage");
    expect(r.policy!.bounds.windowLength).toBe(604800);
    expect(r.policy!.bounds.windows).toBe(12);
    expect(r.policy!.bounds.hardCap).toBe("15000000");
    expect(r.policy!.bounds.totalCap).toBe("120000000");
  });

  it("proceeds kept in the vault", async () => {
    const r = await end2end("buy 5 USDC of MON daily for 30 days, keep the vault, 1% slippage");
    expect(r.policy!.beneficiaryMode).toBe(0);
  });

  it("a fractional amount", async () => {
    const r = await end2end("buy 0.05 USDC of MON daily for 7 days, 1% slippage");
    expect(r.policy!.bounds.perAction).toBe("50000");
  });

  it("defaults slippage when unstated, rather than leaving it open", async () => {
    const r = await end2end("buy 5 USDC of MON daily for 30 days");
    expect(r.policy!.bounds.maxSlippageBps).toBe(100);
  });
});

describe("what it will not do", () => {
  it("refuses a vague sentence instead of inventing numbers", async () => {
    const r = await end2end("buy me some MON whenever");
    expect(r.ok).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/missing/);
  });

  it("still refuses a limit order even when the rest parses", async () => {
    const r = await end2end("place a limit order for 5 USDC of MON daily for 30 days");
    expect(r.ok).toBe(false);
    expect(r.clauses.some((c) => c.verdict === "refused")).toBe(true);
  });

  it("shows all three verdicts for a sentence that mixes them", async () => {
    const r = await end2end("buy 5 USDC of MON daily for 30 days, 1% slippage, on dips, in the mornings");
    expect(r.ok).toBe(true);
    const verdicts = new Set(r.clauses.map((c) => c.verdict));
    expect(verdicts.has("enforced")).toBe(true);
    expect(verdicts.has("advisory")).toBe(true);
    expect(r.policy!.advisory.length).toBe(2);
  });
});
