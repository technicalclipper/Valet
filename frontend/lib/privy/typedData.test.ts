import { beforeAll, describe, expect, it } from "vitest";
import { hashTypedData, type Address } from "viem";
import { domain, types } from "./typedData";

/**
 * The digest a wallet signs must be byte-identical to the one the contract
 * recomputes, or a perfectly valid signature is rejected as BadSignature with no
 * hint why. So each typed message is hashed here exactly as a wallet would and
 * compared against the contract's own digest view, on the live fork.
 */
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
const VALET = process.env.NEXT_PUBLIC_VALET_ADDRESS as Address | undefined;
let live = false;

beforeAll(async () => {
  try {
    const r = await fetch(RPC, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    }).then((x) => x.json());
    live = parseInt(r.result, 16) === 143 && !!VALET;
  } catch { live = false; }
});

describe("what a wallet signs is what the contract checks", () => {
  const holder = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

  it("Claim", async () => {
    if (!live) return;
    const { publicClient } = await import("../chain/client");
    const { valetAbi } = await import("../chain/abi");
    const msg = { capsuleId: 1n, holder, nonce: 3n, deadline: 2_000_000_000n };
    const ours = hashTypedData({ domain: domain(143, VALET!), types, primaryType: "Claim", message: msg });
    const theirs = await publicClient.readContract({
      address: VALET!, abi: valetAbi, functionName: "claimDigest", args: [1n, holder, 3n, 2_000_000_000n],
    });
    expect(ours).toBe(theirs);
  });

  it("PrincipalAction", async () => {
    if (!live) return;
    const { publicClient } = await import("../chain/client");
    const { valetAbi } = await import("../chain/abi");
    const msg = { capsuleId: 1n, action: 1, value: true, nonce: 0n, deadline: 2_000_000_000n };
    const ours = hashTypedData({ domain: domain(143, VALET!), types, primaryType: "PrincipalAction", message: msg });
    const theirs = await publicClient.readContract({
      address: VALET!, abi: valetAbi, functionName: "principalActionDigest", args: [1n, 1, true, 0n, 2_000_000_000n],
    });
    expect(ours).toBe(theirs);
  });

  it("Escalation", async () => {
    if (!live) return;
    const { publicClient } = await import("../chain/client");
    const { valetAbi } = await import("../chain/abi");
    const msg = { capsuleId: 1n, amount: 7_500_000n, nonce: 2n, deadline: 2_000_000_000n };
    const ours = hashTypedData({ domain: domain(143, VALET!), types, primaryType: "Escalation", message: msg });
    const theirs = await publicClient.readContract({
      address: VALET!, abi: valetAbi, functionName: "escalationDigest", args: [1n, 7_500_000n, 2n, 2_000_000_000n],
    });
    expect(ours).toBe(theirs);
  });
});
