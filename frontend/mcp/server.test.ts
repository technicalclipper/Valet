import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createWalletClient, erc20Abi, http, parseEventLogs, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * An agent Valet never wrote, holding a capsule through the MCP server.
 *
 * Spawned exactly as Claude Desktop would spawn it — over stdio, configured by
 * environment — and driven by a real MCP client. Its key is anvil #6, which is
 * neither the managed agent nor anyone else in the app, so whatever it can do
 * it can do only because the capsule was claimed to it.
 */
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545";
const APP = "http://localhost:3000";
const VALET = process.env.NEXT_PUBLIC_VALET_ADDRESS as Address | undefined;
const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
const KURU = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394" as Address;
const ISSUER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OUTSIDE_KEY = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
const issuer = privateKeyToAccount(ISSUER_KEY);
const outside = privateKeyToAccount(OUTSIDE_KEY);

let live = false;
let capsuleId = 0n;
let client: Client;

beforeAll(async () => {
  try {
    const rpc = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }).then((r) => r.json());
    live = parseInt(rpc.result, 16) === 143 && !!VALET;
  } catch { live = false; }
  if (!live) return;

  const { publicClient, monad } = await import("../lib/chain/client");
  const { valetAbi } = await import("../lib/chain/abi");
  const w = createWalletClient({ account: issuer, chain: monad, transport: http(RPC) });
  const now = Number((await publicClient.getBlock()).timestamp);
  const wait = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });

  await wait(await w.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [VALET!, 500_000n] }));
  const opened = await wait(await w.writeContract({ address: VALET!, abi: valetAbi, functionName: "openVault", args: [USDC] }));
  const vaultId = (parseEventLogs({ abi: valetAbi, eventName: "VaultOpened", logs: opened.logs })[0] as unknown as { args: { vaultId: bigint } }).args.vaultId;
  await wait(await w.writeContract({ address: VALET!, abi: valetAbi, functionName: "fundVault", args: [vaultId, 500_000n] }));
  const minted = await wait(await w.writeContract({
    address: VALET!, abi: valetAbi, functionName: "mintCapsule",
    args: [{
      vaultId, principal: issuer.address, mode: 1,
      fixedBeneficiary: "0x0000000000000000000000000000000000000000",
      assetOut: "0x0000000000000000000000000000000000000000",
      policyHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
      bounds: { perAction: 100_000n, perWindow: 100_000n, hardCap: 200_000n, totalCap: 500_000n,
        windows: 5, windowLength: 86_400n, notBefore: BigInt(now), expiresAt: BigInt(now + 5 * 86_400), maxSlippageBps: 100 },
      allowedTargets: [KURU],
    }],
  }));
  capsuleId = (parseEventLogs({ abi: valetAbi, eventName: "CapsuleMinted", logs: minted.logs })[0] as unknown as { args: { capsuleId: bigint } }).args.capsuleId;
  // the recipient (here also the issuer) hands it to the outside agent
  await wait(await w.writeContract({ address: VALET!, abi: valetAbi, functionName: "claim", args: [capsuleId, outside.address] }));

  client = new Client({ name: "valet-test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: "npx",
    args: ["tsx", "mcp/server.ts"],
    env: { ...process.env, VALET_CAPSULE: String(capsuleId), VALET_AGENT_KEY: OUTSIDE_KEY } as Record<string, string>,
    stderr: "pipe",
  }));
}, 90_000);

afterAll(async () => {
  await client?.close();
});

/** Whatever the capsule's console stream replays to a newcomer, read for a moment and closed. */
async function consoleEvents(id: bigint): Promise<{ kind: string; title: string; data?: Record<string, string>; outcome?: string }[]> {
  const ctl = new AbortController();
  const res = await fetch(`${APP}/api/agent/${id}/stream`, { signal: ctl.signal });
  const reader = res.body!.getReader();
  let buf = "";
  const stop = setTimeout(() => ctl.abort(), 1200);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
  } catch { /* aborted, as intended */ } finally { clearTimeout(stop); }
  return buf.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)))
    .filter((e) => e.kind !== "presence");
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  return r.content.map((c) => c.text).join("\n");
}

describe("an outside agent, through MCP", () => {
  it("offers five tools and nothing that could pause, revoke or move the vault", async () => {
    if (!live) return;
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["valet_ask", "valet_capsule", "valet_check", "valet_quote", "valet_trade"]);
  });

  it("reads its permission, and knows it is the holder", async () => {
    if (!live) return;
    const t = await call("valet_capsule");
    expect(t).toMatch(/live/);
    expect(t).toContain(`${outside.address} (you)`);
    expect(t).toMatch(/0\.1 USDC per trade/);
  });

  it("prices a trade on the live book", async () => {
    if (!live) return;
    expect(await call("valet_quote", { usdc: "0.1" })).toMatch(/0\.1 USDC buys about [\d.]+ MON/);
  });

  it("checks for free: the cap is allowed, four times it is refused by name", async () => {
    if (!live) return;
    expect(await call("valet_check")).toMatch(/^Allowed/);
    expect(await call("valet_check", { usdc: "0.4" })).toMatch(/Refused: OVER_ACTION_CAP/);
  });

  it("trades, and the proceeds go to the recipient, not to the agent", async () => {
    if (!live) return;
    const { publicClient } = await import("../lib/chain/client");
    const before = await publicClient.getBalance({ address: issuer.address });
    const t = await call("valet_trade");
    expect(t).toMatch(/^Executed on Kuru\. [\d.]+ MON went to the recipient/);
    expect(t).toContain("kuru.io/markets/0x065c9d28e428a0db40191a54d33d5b7c71a9c394/trade");
    expect(await publicClient.getBalance({ address: issuer.address })).toBeGreaterThan(before);
  }, 30_000);

  it("the trade appears in the console the issuer and recipient watch, read back from the chain", async () => {
    if (!live) return;
    const appUp = await fetch(`${APP}/api/agent/info`).then((r) => r.ok).catch(() => false);
    if (!appUp) return;
    let events: Awaited<ReturnType<typeof consoleEvents>> = [];
    for (let i = 0; i < 20; i++) {
      await fetch(`${APP}/api/keeper/tick`);
      events = await consoleEvents(capsuleId);
      if (events.some((e) => e.kind === "run-end")) break;
    }
    expect(events[0]?.data?.trigger).toBe("outside");
    expect(events[0]?.title).toContain(outside.address.slice(0, 6));
    expect(events.at(-1)).toMatchObject({ kind: "run-end", outcome: "executed" });
  }, 45_000);

  it("a second trade in the same window is refused, and nothing is sent", async () => {
    if (!live) return;
    expect(await call("valet_trade")).toMatch(/Refused by the contract: OVER_WINDOW_CAP/);
  }, 30_000);

  it("can ask for more, and the ask shows as waiting for the issuer", async () => {
    if (!live) return;
    expect(await call("valet_ask", { usdc: "0.15", reason: "deep book" })).toMatch(/^Asked \(nonce \d+\)/);
    expect(await call("valet_capsule")).toMatch(/0\.15 USDC, waiting for the issuer/);
  }, 30_000);
});
