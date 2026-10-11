import { beforeAll, describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, type Address, type EIP1193Provider } from "viem";

/**
 * The mint flow, against the live fork, with the wallet popup replaced by a
 * provider that declines on cue.
 *
 * A declined Privy confirmation surfaces as an EIP-1193 4001. This provider
 * forwards everything to anvil — whose accounts are unlocked, so
 * eth_sendTransaction signs on its side — except that it throws exactly that
 * error on the Nth transaction. That is enough to test what actually broke: what
 * is left on chain after a refusal, and whether a retry repeats work.
 */
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
const ACCOUNT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address; // anvil #2
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

const rpc = (method: string, params: unknown[] = []) =>
  fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json());

function provider(declineOnTx?: number): EIP1193Provider {
  let sent = 0;
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_sendTransaction") {
        sent += 1;
        if (sent === declineOnTx) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
      }
      const res = await rpc(method, params ?? []);
      if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code });
      return res.result;
    },
    on: () => {},
    removeListener: () => {},
  } as unknown as EIP1193Provider;
}

let live = false;
beforeAll(async () => {
  try {
    live = parseInt((await rpc("eth_chainId")).result, 16) === 143 && !!process.env.NEXT_PUBLIC_VALET_ADDRESS;
  } catch {
    live = false;
  }
  if (!live) return;
  // gas, and 50,000 USDC in the account's _balances slot
  await rpc("anvil_setBalance", [ACCOUNT, "0x56BC75E2D63100000"]);
  const slot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ACCOUNT, 9n]));
  await rpc("anvil_setStorageAt", [USDC, slot, "0x0000000000000000000000000000000000000000000000000000000ba43b7400"]);
  // start each run with no standing allowance, so the approve step is real
  await rpc("anvil_impersonateAccount", [ACCOUNT]);
});

async function freshPolicy() {
  const { compile } = await import("../policy/compile");
  const { extractWithRules } = await import("../policy/extract");
  const { withHash } = await import("../policy/canonical");
  const { chainNow } = await import("./writes");
  const s = "Buy 5 USDC of MON daily for 30 days, max 1% slippage, send the MON to bob";
  // the recipient is a hashed term now, so a policy without one cannot mint
  return withHash(compile(s, await extractWithRules(s), await chainNow(), { recipient: ACCOUNT }).policy!);
}

async function resetAllowance() {
  const { addresses, valetAddress } = await import("../config/chain");
  const { createWalletClient, custom, erc20Abi } = await import("viem");
  const { monad, publicClient } = await import("./client");
  const w = createWalletClient({ account: ACCOUNT, chain: monad, transport: custom(provider()) });
  const h = await w.writeContract({ address: addresses.usdc, abi: erc20Abi, functionName: "approve", args: [valetAddress(), 0n] });
  await publicClient.waitForTransactionReceipt({ hash: h });
}

describe("minting, when the person says no", () => {
  it("declining the approval leaves nothing on chain", async () => {
    if (!live) return;
    const { mintCapsule, MintInterrupted } = await import("./writes");
    const { publicClient } = await import("./client");
    const { valetAbi } = await import("./abi");
    const { valetAddress } = await import("../config/chain");
    await resetAllowance();

    const vaultsBefore = await publicClient.readContract({ address: valetAddress(), abi: valetAbi, functionName: "nextVaultId" });
    const err = await mintCapsule(provider(1), ACCOUNT, await freshPolicy(), () => {}).catch((e) => e);

    expect(err).toBeInstanceOf(MintInterrupted);
    expect(err.step).toBe("approve");
    expect(err.declined).toBe(true);
    expect(err.vaultId).toBeUndefined();
    const vaultsAfter = await publicClient.readContract({ address: valetAddress(), abi: valetAbi, functionName: "nextVaultId" });
    expect(vaultsAfter).toBe(vaultsBefore); // the old order opened a vault here
  });

  it("declining later keeps the vault, and continuing neither reopens nor double-funds", async () => {
    if (!live) return;
    const { mintCapsule, MintInterrupted } = await import("./writes");
    const { publicClient } = await import("./client");
    const { valetAbi } = await import("./abi");
    const { valetAddress } = await import("../config/chain");
    await resetAllowance();
    const policy = await freshPolicy();

    // tx 1 approve, tx 2 open vault, tx 3 fund -> declined
    const err = await mintCapsule(provider(3), ACCOUNT, policy, () => {}).catch((e) => e);
    expect(err).toBeInstanceOf(MintInterrupted);
    expect(err.step).toBe("fund");
    expect(err.declined).toBe(true);
    expect(err.vaultId).toBeDefined();

    const vaultsMid = await publicClient.readContract({ address: valetAddress(), abi: valetAbi, functionName: "nextVaultId" });

    // continue: the approval already stands and the vault already exists
    const steps: string[] = [];
    const out = await mintCapsule(provider(), ACCOUNT, policy, (p) => steps.push(p.step), { vaultId: err.vaultId });

    expect(out.vaultId).toBe(err.vaultId);
    expect(steps).not.toContain("approve"); // allowance was already granted
    expect(steps).not.toContain("vault"); // resumed, not reopened
    expect(steps).toContain("fund");
    expect(steps).toContain("mint");

    const vaultsAfter = await publicClient.readContract({ address: valetAddress(), abi: valetAbi, functionName: "nextVaultId" });
    expect(vaultsAfter).toBe(vaultsMid); // no second vault

    const vault = (await publicClient.readContract({
      address: valetAddress(), abi: valetAbi, functionName: "getVault", args: [out.vaultId],
    })) as unknown as { balance: bigint };
    expect(vault.balance).toBe(BigInt(policy.bounds.totalCap)); // funded exactly once
  });
});
