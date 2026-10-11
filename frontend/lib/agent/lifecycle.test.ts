import { beforeAll, describe, expect, it } from "vitest";
import { createWalletClient, erc20Abi, http, parseEventLogs, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * The whole lifecycle, through the real HTTP routes, on the fork.
 *
 * Issuer, recipient and agent are three different keys. The recipient never
 * holds MON — every one of its actions is a signature the relayer submits. The
 * agent asks for more twice: once inside the hard cap, which the issuer approves
 * and the agent spends; once over it, which the issuer also approves and the
 * chain refuses anyway.
 */
const APP = "http://localhost:3000";
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
const VALET = process.env.NEXT_PUBLIC_VALET_ADDRESS as Address | undefined;
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
const KURU = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394" as Address;

// anvil #0 funds and issues; anvil #4 is the recipient, holding nothing
const issuer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const recipient = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");

let live = false;
let capsuleId = 0n;

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${APP}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, ...(await r.json()) }));

// a stranger: party to nothing
const stranger = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");

/** Prove who is calling, the way a script or the MCP server does: sign the action, the capsule and the time. */
async function as(who: typeof issuer, action: string) {
  const at = Math.floor(Date.now() / 1000);
  const signature = await who.signMessage({ message: `Valet: ${action} capsule ${capsuleId} at ${at}` });
  return { "x-valet-signature": signature, "x-valet-at": String(at) };
}

beforeAll(async () => {
  try {
    const [rpc, app] = await Promise.all([
      fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }).then((r) => r.json()),
      fetch(`${APP}/api/agent/info`).then((r) => r.ok),
    ]);
    live = parseInt(rpc.result, 16) === 143 && app && !!VALET;
  } catch { live = false; }
  if (!live) return;

  const { publicClient, monad } = await import("../chain/client");
  const { valetAbi } = await import("../chain/abi");
  const w = createWalletClient({ account: issuer, chain: monad, transport: http(RPC) });
  const now = Number((await publicClient.getBlock()).timestamp);

  // the recipient starts with nothing at all
  await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [recipient.address, "0x0"] }) });

  let h = await w.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [VALET!, 700_000n] });
  await publicClient.waitForTransactionReceipt({ hash: h });
  h = await w.writeContract({ address: VALET!, abi: valetAbi, functionName: "openVault", args: [USDC] });
  const r = await publicClient.waitForTransactionReceipt({ hash: h });
  const vaultId = (parseEventLogs({ abi: valetAbi, eventName: "VaultOpened", logs: r.logs })[0] as unknown as { args: { vaultId: bigint } }).args.vaultId;
  h = await w.writeContract({ address: VALET!, abi: valetAbi, functionName: "fundVault", args: [vaultId, 700_000n] });
  await publicClient.waitForTransactionReceipt({ hash: h });
  h = await w.writeContract({
    address: VALET!, abi: valetAbi, functionName: "mintCapsule",
    args: [{
      vaultId, principal: recipient.address, mode: 1,
      fixedBeneficiary: "0x0000000000000000000000000000000000000000",
      assetOut: "0x0000000000000000000000000000000000000000",
      policyHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      bounds: { perAction: 100_000n, perWindow: 100_000n, hardCap: 200_000n, totalCap: 700_000n,
        windows: 7, windowLength: 86_400n, notBefore: BigInt(now), expiresAt: BigInt(now + 7 * 86_400), maxSlippageBps: 100 },
      allowedTargets: [KURU],
    }],
  });
  const mr = await publicClient.waitForTransactionReceipt({ hash: h });
  capsuleId = (parseEventLogs({ abi: valetAbi, eventName: "CapsuleMinted", logs: mr.logs })[0] as unknown as { args: { capsuleId: bigint } }).args.capsuleId;
}, 60_000);

async function capsule() {
  const { readCapsule } = await import("../chain/reads");
  return readCapsule(capsuleId);
}
async function principalNonce() {
  const { publicClient } = await import("../chain/client");
  const { valetAbi } = await import("../chain/abi");
  return publicClient.readContract({ address: VALET!, abi: valetAbi, functionName: "principalNonce", args: [capsuleId] }) as Promise<bigint>;
}
async function sign(who: typeof issuer, primaryType: "Claim" | "PrincipalAction" | "Escalation", message: Record<string, unknown>) {
  const { domain, types } = await import("../privy/typedData");
  return who.signTypedData({ domain: domain(143, VALET!), types, primaryType, message: message as never });
}
/**
 * One run per capsule at a time is the runtime's rule, so an ask that arrives
 * while the previous elevated spend is still settling is correctly turned away.
 * Wait for the lock rather than race it.
 */
async function askWhenFree(amount: string, reason: string) {
  const end = Date.now() + 20_000;
  for (;;) {
    const r = await post(`/api/agent/${capsuleId}/ask`, { amount, reason }, await as(issuer, "ask"));
    if (r.ok || !/in progress/.test(String(r.reason)) || Date.now() > end) return r;
    await new Promise((res) => setTimeout(res, 400));
  }
}

async function waitFor(fn: () => Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 300)); }
  return false;
}

describe("the full lifecycle, through the relayer", () => {
  it("only the issuer or recipient can make the agent ask, since every ask costs the agent gas", async () => {
    if (!live) return;
    const nobody = await post(`/api/agent/${capsuleId}/ask`, { amount: "150000", reason: "x" });
    expect(nobody.status).toBe(401);
    const outsider = await post(`/api/agent/${capsuleId}/ask`, { amount: "150000", reason: "x" }, await as(stranger, "ask"));
    expect(outsider.status).toBe(403);
    // the issuer's signature for a different action does not carry over: checked
    // against the ask message it recovers to some unrelated address
    const wrongAction = await post(`/api/agent/${capsuleId}/ask`, { amount: "150000", reason: "x" }, await as(issuer, "run"));
    expect(wrongAction.status).toBe(403);
  }, 30_000);

  it("a stranger cannot drip the window away in tiny trades", async () => {
    if (!live) return;
    const tiny = await post(`/api/agent/${capsuleId}/run`, { amountIn: "1000" }, await as(stranger, "run"));
    expect(tiny.status).toBe(403);
  }, 30_000);

  it("a recipient with no gas claims, choosing the managed agent", async () => {
    if (!live) return;
    const agent = (await fetch(`${APP}/api/agent/info`).then((r) => r.json())).address as Address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
    const signature = await sign(recipient, "Claim", { capsuleId, holder: agent, nonce: await principalNonce(), deadline });
    const res = await post("/api/relay/claim", { capsuleId: String(capsuleId), holder: agent, deadline: String(deadline), signature });
    expect(res.ok).toBe(true);
    expect((await capsule()).holder.toLowerCase()).toBe(agent.toLowerCase());
  }, 30_000);

  it("a replayed claim signature is turned away for free", async () => {
    if (!live) return;
    const agent = (await fetch(`${APP}/api/agent/info`).then((r) => r.json())).address as Address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
    const signature = await sign(recipient, "Claim", { capsuleId, holder: agent, nonce: 0n, deadline });
    const res = await post("/api/relay/claim", { capsuleId: String(capsuleId), holder: agent, deadline: String(deadline), signature });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already been claimed|does not match/);
  }, 30_000);

  it("pauses and resumes by signature, and the recipient still holds nothing", async () => {
    if (!live) return;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
    for (const value of [true, false]) {
      const signature = await sign(recipient, "PrincipalAction", { capsuleId, action: 0, value, nonce: await principalNonce(), deadline });
      const res = await post("/api/relay/principal", { capsuleId: String(capsuleId), action: 0, value, deadline: String(deadline), signature });
      expect(res.ok).toBe(true);
      expect((await capsule()).pausedByPrincipal).toBe(value);
    }
    const { publicClient } = await import("../chain/client");
    expect(await publicClient.getBalance({ address: recipient.address })).toBe(0n);
  }, 30_000);

  it("the agent asks for 1.5x, the issuer signs, and the agent spends it", async () => {
    if (!live) return;
    const ask = await askWhenFree("150000", "deep book today");
    expect(ask.ok).toBe(true);
    const nonce = BigInt(ask.nonce);
    const before = (await capsule()).spentTotal;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
    const signature = await sign(issuer, "Escalation", { capsuleId, amount: 150_000n, nonce, deadline });
    const res = await post("/api/relay/escalation", {
      capsuleId: String(capsuleId), amount: "150000", nonce: String(nonce), deadline: String(deadline), signature,
    });
    expect(res.ok).toBe(true);
    // the approval kicks the agent; wait for its spend to land
    expect(await waitFor(async () => (await capsule()).spentTotal === before + 150_000n)).toBe(true);
  }, 40_000);

  it("the agent asks for 10x, the issuer signs that too, and the hard cap refuses it", async () => {
    if (!live) return;
    const ask = await askWhenFree("1000000", "let me go big");
    expect(ask.ok).toBe(true);
    const nonce = BigInt(ask.nonce);
    const before = (await capsule()).spentTotal;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
    const signature = await sign(issuer, "Escalation", { capsuleId, amount: 1_000_000n, nonce, deadline });
    const res = await post("/api/relay/escalation", {
      capsuleId: String(capsuleId), amount: "1000000", nonce: String(nonce), deadline: String(deadline), signature,
    });
    expect(res.ok).toBe(true); // the approval itself is genuine and lands on chain
    const { readEscalation } = await import("../chain/reads");
    expect((await readEscalation(capsuleId, nonce)).approved).toBe(true);
    await new Promise((r) => setTimeout(r, 4000)); // give the agent's run time to finish
    expect((await capsule()).spentTotal).toBe(before); // and yet nothing moved
    expect((await readEscalation(capsuleId, nonce)).consumed).toBe(false);
  }, 40_000);

  it("a stranger's signature cannot pause it", async () => {
    if (!live) return;
    const stranger = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 365 * 86_400);
    const signature = await sign(stranger, "PrincipalAction", { capsuleId, action: 0, value: true, nonce: await principalNonce(), deadline });
    const res = await post("/api/relay/principal", { capsuleId: String(capsuleId), action: 0, value: true, deadline: String(deadline), signature });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not match/);
  }, 30_000);
});
