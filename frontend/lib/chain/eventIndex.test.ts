import { beforeAll, describe, expect, it } from "vitest";

/**
 * The index must hold exactly what one unlimited eth_getLogs would return.
 * Monad's public RPC allows a hundred blocks per call; here the range is
 * forced down to seven, so even a short fork history spans many calls, and the
 * result is compared with a single call against anvil, which has no limit.
 */
let live = false;

beforeAll(async () => {
  process.env.LOG_RANGE = "7";
  process.env.LOG_PARALLEL = "3";
  try {
    const { publicClient } = await import("./client");
    live = (await publicClient.getChainId()) === 143 && !!process.env.NEXT_PUBLIC_VALET_ADDRESS;
  } catch { live = false; }
});

describe("the event index", () => {
  it("matches a single unlimited log query, in order, read seven blocks at a time", async () => {
    if (!live) return;
    (globalThis as { __valetIndex?: unknown }).__valetIndex = undefined;
    const { publicClient } = await import("./client");
    const { valetAbi } = await import("./abi");
    const { chain, valetAddress } = await import("../config/chain");
    const { parseEventLogs } = await import("viem");
    const { logs, indexedThrough } = await import("./eventIndex");

    // a cache file from a normal run would hide the chunking; start from nothing
    const { rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    rmSync(join(process.cwd(), "data", "index", `${chain.id}-${valetAddress().toLowerCase()}.json`), { force: true });

    const mine = await logs();
    const through = indexedThrough();
    const raw = await publicClient.getLogs({ address: valetAddress(), fromBlock: chain.deployBlock, toBlock: through });
    const theirs = parseEventLogs({ abi: valetAbi, logs: raw });

    expect(through - chain.deployBlock).toBeGreaterThan(14n); // genuinely many ranges
    expect(mine.length).toBe(theirs.length);
    expect(mine.map((l) => `${l.transactionHash}:${l.logIndex}`)).toEqual(theirs.map((l) => `${l.transactionHash}:${l.logIndex}`));
  }, 120_000);

  it("filters by event and indexed argument, any checksum casing", async () => {
    if (!live) return;
    const { logs } = await import("./eventIndex");
    const all = await logs({ eventName: "CapsuleMinted" });
    expect(all.length).toBeGreaterThan(0);
    const p = String(all[0].args.principal);
    const lower = await logs({ eventName: "CapsuleMinted", args: { principal: p.toLowerCase() } });
    expect(lower.length).toBeGreaterThan(0);
    expect(lower.every((l) => String(l.args.principal).toLowerCase() === p.toLowerCase())).toBe(true);
  });
});
