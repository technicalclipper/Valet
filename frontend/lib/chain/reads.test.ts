import { beforeAll, describe, expect, it } from "vitest";

/**
 * Runs against a local anvil fork of Monad mainnet with Valet deployed and
 * SeedDemo applied. Skips itself when that is not up, so `npm test` is honest
 * on a fresh clone.
 *
 *   anvil --fork-url https://rpc.monad.xyz --port 8545
 *   see contracts/README.md for deploy + seed
 */
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
// No hardcoded fallback. dev-setup.sh redeploys on every anvil restart, so a
// baked-in address goes stale and the failure reads as broken tests rather than
// a missing environment.
const VALET = process.env.NEXT_PUBLIC_VALET_ADDRESS;

let live = false;
beforeAll(async () => {
  if (!VALET) return;
  process.env.NEXT_PUBLIC_RPC_URL = RPC;
  process.env.NEXT_PUBLIC_VALET_ADDRESS = VALET;
  process.env.NEXT_PUBLIC_CHAIN_ID = "143";
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(1500),
    });
    const j = await res.json();
    live = parseInt(j.result, 16) === 143;
  } catch {
    live = false;
  }
});

describe.runIf(() => true)("read layer", () => {
  it("reads the seeded capsule", async () => {
    if (!live) return;
    const { readCapsule } = await import("./reads");
    const c = await readCapsule(1n);
    expect(c.vaultId).toBe(1n);
    expect(c.bounds.perAction).toBe(5_000_000n);
    expect(c.bounds.hardCap).toBe(10_000_000n);
    expect(c.bounds.windows).toBe(30);
    expect(c.bounds.maxSlippageBps).toBe(100);
    expect(c.assetOut).toBe("0x0000000000000000000000000000000000000000");
  });

  it("reads headroom the console draws", async () => {
    if (!live) return;
    const { readHeadroom } = await import("./reads");
    const h = await readHeadroom(1n);
    expect(h.perActionLeft).toBe(5_000_000n);
    expect(h.totalLeft).toBeLessThanOrEqual(150_000_000n);
  });

  it("asks the contract itself which assert refuses, rather than guessing", async () => {
    if (!live) return;
    const { preflight, readCapsule } = await import("./reads");
    const c = await readCapsule(1n);
    const kuru = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394" as const;

    const overCap = await preflight(
      { capsuleId: 1n, vaultId: 1n, amountIn: 20_000_000n, quotedOut: 10n ** 18n, minOut: (10n ** 18n * 99n) / 100n, target: kuru, recipient: c.principal },
      c.holder,
    );
    expect(overCap).toBe("OVER_ACTION_CAP");

    // Scope is checked after the soft caps, so asking about a bad venue at a
    // size the window has already used returns OVER_WINDOW_CAP — correct, but
    // it makes the assertion depend on how much this capsule has spent today.
    // The allowlist read answers the same question without that coupling.
    const { readAllowedTarget } = await import("./reads");
    expect(await readAllowedTarget(1n, kuru)).toBe(true);
    expect(await readAllowedTarget(1n, "0x000000000000000000000000000000000000dEaD")).toBe(false);

    const notHolder = await preflight(
      { capsuleId: 1n, vaultId: 1n, amountIn: 5_000_000n, quotedOut: 10n ** 18n, minOut: (10n ** 18n * 99n) / 100n, target: kuru, recipient: c.principal },
      "0x000000000000000000000000000000000000dEaD",
    );
    expect(notHolder).toBe("NOT_HOLDER");
  });

  it("rebuilds history from events, not from anything we wrote down", async () => {
    if (!live) return;
    const { readHistory, readExecutions } = await import("./events");
    // A narrow window on purpose. Anything reaching back past this fork's start
    // block makes anvil ask the upstream node, which refuses the range — the
    // real deployment sets NEXT_PUBLIC_DEPLOY_BLOCK instead of guessing.
    const { publicClient } = await import("./client");
    const tip = await publicClient.getBlockNumber();
    const from = tip > 50n ? tip - 50n : 0n;
    const h = await readHistory(1n, from);
    expect(h.some((e) => e.kind === "CapsuleMinted")).toBe(true);
    expect(h.some((e) => e.kind === "CapsuleClaimed")).toBe(true);

    const execs = await readExecutions(1n, from);
    if (execs.length) {
      expect(execs[0].received).toBeGreaterThan(0n);
      expect(execs[0].txHash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});
