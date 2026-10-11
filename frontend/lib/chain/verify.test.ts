import { describe, expect, it } from "vitest";
import { verifyCapsule, verifyTargets, verdictLine } from "./verify";
import { compile } from "../policy/compile";
import { extractWithRules } from "../policy/extract";
import { policyHash } from "../policy/canonical";
import type { OnChainCapsule } from "./reads";
import type { Policy } from "../policy/types";

const NOW = 1_700_000_000;
const SENTENCE = "Buy 5 USDC of MON daily for 30 days, max 1% slippage, send the MON to bob";

async function policy(): Promise<Policy> {
  const r = compile(SENTENCE, await extractWithRules(SENTENCE), NOW, {
    recipient: "0x0000000000000000000000000000000000000b0b",
  });
  return r.policy!;
}

/** A capsule that faithfully implements the given policy. */
function capsuleFor(p: Policy, overrides: Partial<OnChainCapsule> = {}): OnChainCapsule {
  return {
    vaultId: 1n,
    issuer: "0xaaaa000000000000000000000000000000000001",
    principal: "0x0000000000000000000000000000000000000b0b",
    holder: "0xaaaa000000000000000000000000000000000002",
    mode: p.beneficiaryMode,
    fixedBeneficiary: p.fixedBeneficiary as `0x${string}`,
    assetOut: p.assetOut as `0x${string}`,
    policyHash: policyHash(p),
    bounds: {
      perAction: BigInt(p.bounds.perAction),
      perWindow: BigInt(p.bounds.perWindow),
      hardCap: BigInt(p.bounds.hardCap),
      totalCap: BigInt(p.bounds.totalCap),
      windows: p.bounds.windows,
      windowLength: BigInt(p.bounds.windowLength),
      notBefore: BigInt(p.bounds.notBefore),
      expiresAt: BigInt(p.bounds.expiresAt),
      maxSlippageBps: p.bounds.maxSlippageBps,
    },
    spentTotal: 0n, spentInWindow: 0n, lastWindowIndex: 0,
    revoked: false, surrendered: false, pausedByIssuer: false, pausedByPrincipal: false,
    ...overrides,
  };
}

describe("a faithful capsule", () => {
  it("verifies, and says so in one line", async () => {
    const p = await policy();
    const v = verifyCapsule(p, capsuleFor(p));
    expect(v.verified).toBe(true);
    expect(v.hashMatches).toBe(true);
    expect(v.failures).toHaveLength(0);
    expect(v.fields).toHaveLength(13);
    expect(verdictLine(v)).toMatch(/Verified/);
  });
});

describe("a tampered document", () => {
  it("fails the hash check", async () => {
    const p = await policy();
    const capsule = capsuleFor(p);
    const altered: Policy = { ...p, bounds: { ...p.bounds, perAction: "50000000" } };
    const v = verifyCapsule(altered, capsule);
    expect(v.hashMatches).toBe(false);
    expect(v.verified).toBe(false);
    expect(verdictLine(v)).toMatch(/not the one hashed at mint/);
  });
});

describe("the attack a hash check alone cannot catch", () => {
  /**
   * A server shows policy P, hashes P into policyHash honestly, and then mints
   * a capsule whose caps are ten times P's. The hash matches perfectly. Only
   * reading the capsule's own numbers back finds it.
   */
  it("catches a capsule minted looser than the document it hashed", async () => {
    const p = await policy();
    const lying = capsuleFor(p, {
      bounds: { ...capsuleFor(p).bounds, perAction: 50_000_000n, hardCap: 100_000_000n },
    });

    const v = verifyCapsule(p, lying);
    expect(v.hashMatches).toBe(true); // the document is genuine
    expect(v.verified).toBe(false); // the capsule is not what it describes
    expect(v.failures.map((f) => f.field).sort()).toEqual(["hardCap", "perAction"]);
    expect(verdictLine(v)).toMatch(/differs on perAction, hardCap/);
  });

  it("catches a redirected beneficiary", async () => {
    const p = await policy();
    const v = verifyCapsule(p, capsuleFor(p, { mode: 2, fixedBeneficiary: "0x000000000000000000000000000000000000dead" }));
    expect(v.hashMatches).toBe(true);
    expect(v.verified).toBe(false);
    expect(v.failures.map((f) => f.field)).toContain("beneficiaryMode");
  });

  it("catches a swapped output asset", async () => {
    const p = await policy();
    const v = verifyCapsule(p, capsuleFor(p, { assetOut: "0x000000000000000000000000000000000000beef" }));
    expect(v.verified).toBe(false);
    expect(v.failures.map((f) => f.field)).toContain("assetOut");
  });

  it("catches a shortened term", async () => {
    const p = await policy();
    const base = capsuleFor(p);
    const v = verifyCapsule(p, capsuleFor(p, { bounds: { ...base.bounds, windows: 3 } }));
    expect(v.verified).toBe(false);
    expect(v.failures.map((f) => f.field)).toContain("windows");
  });
});

describe("who it is for", () => {
  /**
   * The gap this closes: the recipient was not hashed and not checked, so a
   * capsule minted for someone else entirely still showed "verified".
   */
  it("catches a capsule minted for a different recipient", async () => {
    const p = await policy();
    const v = verifyCapsule(p, capsuleFor(p, { principal: "0x000000000000000000000000000000000000beef" }));
    expect(v.hashMatches).toBe(true); // the document is genuine
    expect(v.verified).toBe(false); // but it is not for the person it names
    expect(v.failures.map((f) => f.field)).toEqual(["recipient"]);
  });

  it("is part of the hash, so a link cannot swap it either", async () => {
    const a = await policy();
    const b = compile(SENTENCE, await extractWithRules(SENTENCE), NOW, {
      recipient: "0x000000000000000000000000000000000000beef",
    }).policy!;
    expect(policyHash(a)).not.toBe(policyHash(b));
  });
});

describe("the venue allowlist", () => {
  it("is checked per address, since a mapping cannot be read wholesale", async () => {
    const p = await policy();
    const ok = verifyTargets(p, { [p.allowedTargets[0].toLowerCase()]: true });
    expect(ok.every((f) => f.ok)).toBe(true);

    const bad = verifyTargets(p, {});
    expect(bad[0].ok).toBe(false);
    expect(bad[0].chain).toBe("not allowed");
  });
});
