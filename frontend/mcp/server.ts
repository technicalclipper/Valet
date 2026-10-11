/**
 * Valet over MCP: one capsule, handed to an agent Valet did not write.
 *
 * Point Claude Desktop, Cursor or any MCP client at this, with the capsule's id
 * and the key it was claimed to, and that agent can read its permission, price
 * a trade on Kuru, ask the contract whether a trade would pass, trade, and ask
 * the issuer for more. Five tools, and nothing else: no tool can pause, revoke,
 * redirect or touch the vault, because the key behind them is only the
 * holder's, and the contract gives the holder nothing more.
 *
 * Every limit holds exactly as it does for Valet's own agent. The checks are in
 * the contract, not in this file — a client that skipped every tool here and
 * called execute() directly would be refused by the same nineteen names.
 *
 *   claude mcp add valet -e VALET_CAPSULE=4 -e VALET_AGENT_KEY=0x… -- <repo>/frontend/node_modules/.bin/tsx <repo>/frontend/mcp/server.ts
 *
 * See mcp/README.md for Claude Desktop.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { configure } from "./env";

// A function rather than top-level await: tsx runs this as CommonJS, beside the app.
async function main() {
  const { capsuleId } = configure();

  // imported only after configure(): these read the chain from the environment as they load
  const [{ preflight, readBeneficiary, readCapsule, readEscalation, readHeadroom }, runtime, { addresses, chain: cfg },
    { amount, duration, ASSERT_LABEL }, { serverAccount }, { publicClient }, { valetAbi }] = await Promise.all([
    import("../lib/chain/reads"),
    import("../lib/agent/runtime"),
    import("../lib/config/chain"),
    import("../lib/format"),
    import("../lib/server/keys"),
    import("../lib/chain/client"),
    import("../lib/chain/abi"),
  ]);

  const id = BigInt(capsuleId);
  const me = serverAccount("AGENT_PRIVATE_KEY").address;
  const USDC = 6;

  /** "5" or "5.5" USDC to base units, refusing anything that is not a plain amount. */
  function usdc(v: string | undefined): bigint | undefined {
    if (v === undefined) return undefined;
    const m = v.trim().match(/^(\d+)(?:\.(\d{1,6}))?$/);
    if (!m) throw new Error(`"${v}" is not an amount of USDC.`);
    return BigInt(m[1]) * 10n ** BigInt(USDC) + BigInt((m[2] ?? "").padEnd(USDC, "0") || "0");
  }
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
  const explain = (name: string) => `${name} — ${ASSERT_LABEL[name as keyof typeof ASSERT_LABEL] ?? "refused by the contract"}`;

  async function buildRequest(amountIn: bigint) {
    const c = await readCapsule(id);
    const q = await runtime.quote(amountIn);
    const minOut = q.out - (q.out * BigInt(c.bounds.maxSlippageBps)) / 10_000n;
    const req = {
      capsuleId: id, vaultId: c.vaultId, amountIn, quotedOut: q.out, minOut,
      target: addresses.kuruMarket, recipient: await readBeneficiary(id),
    };
    return { c, q, minOut, req };
  }

  const server = new McpServer(
    { name: "valet", version: "0.1.0" },
    {
      instructions:
        `You hold Valet capsule #${capsuleId}: bounded, revocable authority to buy MON with USDC on Kuru, ` +
        "on behalf of the person it was given to. Proceeds go to them, never to you. Call valet_capsule first " +
        "to see what you may do. Call valet_check before valet_trade — a refusal there is free, a trade is not. " +
        "If you need more than the per-action cap, use valet_ask; only the issuer can approve it.",
    },
  );

  server.registerTool("valet_capsule", {
    title: "Read the permission",
    description: "What this capsule lets you do, how much is left today and in total, who the proceeds go to, and any pending request for more.",
    inputSchema: {},
  }, async () => {
    const c = await readCapsule(id);
    const h = await readHeadroom(id);
    const b = c.bounds;
    const now = Math.floor(Date.now() / 1000);
    const status = c.revoked ? "revoked by the issuer" : c.surrendered ? "handed back by the recipient"
      : c.pausedByIssuer || c.pausedByPrincipal ? "paused" : Number(b.expiresAt) <= now ? "expired" : "live";
    const lines = [
      `Capsule #${capsuleId} on ${cfg.label} — ${status}.`,
      `You are ${me}; the holder is ${c.holder}${c.holder.toLowerCase() === me.toLowerCase() ? " (you)" : " — NOT you, so every trade will be refused as NOT_HOLDER"}.`,
      `Up to ${amount(b.perAction)} per trade and ${amount(b.perWindow)} per window of ${duration(b.windowLength)}, for ${b.windows} windows.`,
      `Never more than ${amount(b.hardCap)} in one trade even with approval; ${amount(b.totalCap)} in total.`,
      `Slippage at most ${b.maxSlippageBps / 100}%. Venue: Kuru MON/USDC (${addresses.kuruMarket}) and nothing else.`,
      `Proceeds go to ${await readBeneficiary(id)} in the same transaction as the trade.`,
      `Left now: ${amount(h.windowLeft)} in window ${Number(h.windowIndex) + 1}, ${amount(h.totalLeft)} in total.`,
    ];
    const next = (await publicClient.readContract({
      address: addresses.valet!, abi: valetAbi, functionName: "escalationNonce", args: [id],
    })) as bigint;
    if (next > 0n) {
      const e = await readEscalation(id, next - 1n);
      const state = e.consumed ? "used" : e.approved ? `APPROVED for ${amount(e.approvedAmount)} — pass approval_nonce ${next - 1n} to valet_trade` : "waiting for the issuer";
      lines.push(`Last request for more (nonce ${next - 1n}): ${amount(e.requestedAmount)}, ${state}.`);
    }
    return text(lines.join("\n"));
  });

  server.registerTool("valet_quote", {
    title: "Price a trade on Kuru",
    description: "What an amount of USDC buys in MON right now, from the top of Kuru's live order book, and the floor the capsule would set.",
    inputSchema: { usdc: z.string().describe('amount of USDC, e.g. "5"').optional() },
  }, async ({ usdc: v }) => {
    const c = await readCapsule(id);
    const amountIn = usdc(v) ?? c.bounds.perAction;
    const q = await runtime.quote(amountIn);
    const minOut = q.out - (q.out * BigInt(c.bounds.maxSlippageBps)) / 10_000n;
    const px = Number((q.ask * 10_000n) / 10n ** 16n) / 10_000;
    return text(`${amount(amountIn)} buys about ${amount(q.out, 18, "MON")} at ${px.toFixed(4)} USDC per MON. ` +
      `A trade would accept no less than ${amount(minOut, 18, "MON")}.`);
  });

  server.registerTool("valet_check", {
    title: "Would this trade pass?",
    description: "Ask the contract — without sending anything — whether a trade of this size would pass all nineteen checks right now. Free.",
    inputSchema: {
      usdc: z.string().describe('amount of USDC, e.g. "5"; defaults to the per-action cap').optional(),
      approval_nonce: z.number().int().nonnegative().describe("check against an approved request for more").optional(),
    },
  }, async ({ usdc: v, approval_nonce }) => {
    const c = await readCapsule(id);
    const { req } = await buildRequest(usdc(v) ?? c.bounds.perAction);
    const verdict = await preflight(req, me, approval_nonce !== undefined);
    return text(verdict === "NONE"
      ? `Allowed: all nineteen checks pass for ${amount(req.amountIn)}. valet_trade would execute it.`
      : `Refused: ${explain(verdict)}. Nothing was sent.`);
  });

  server.registerTool("valet_trade", {
    title: "Trade",
    description: "Buy MON with USDC on Kuru inside the capsule's limits. Proceeds go straight to the recipient in the same transaction. The contract refuses anything outside the limits by name, and a refused trade sends nothing.",
    inputSchema: {
      usdc: z.string().describe('amount of USDC, e.g. "5"; defaults to the per-action cap').optional(),
      approval_nonce: z.number().int().nonnegative().describe("spend under an approved request for more").optional(),
    },
  }, async ({ usdc: v, approval_nonce }) => {
    const r = await runtime.runOnce(capsuleId, {
      amountIn: usdc(v),
      elevatedNonce: approval_nonce === undefined ? undefined : BigInt(approval_nonce),
    });
    if (!r.started) return text(`Not started: ${r.reason}.`);
    if (r.outcome === "executed")
      return text(`Executed. ${amount(BigInt(r.received!), 18, "MON")} went to the recipient. Transaction ${r.txHash}` +
        (cfg.isMainnet ? ` — ${cfg.explorer}/tx/${r.txHash}` : ` (on ${cfg.label}).`));
    if (r.outcome === "refused") return text(`Refused by the contract: ${explain(r.refusedBy!)}. No transaction was sent, nothing moved.`);
    return { ...text(`The trade did not complete: ${r.error}`), isError: true };
  });

  server.registerTool("valet_ask", {
    title: "Ask the issuer for more",
    description: "Ask to spend more than the per-action cap in one trade. This only asks — it moves nothing and lifts nothing until the issuer approves with their own key. The hard cap can never be lifted.",
    inputSchema: {
      usdc: z.string().describe('the one-off amount wanted, e.g. "7.5"'),
      reason: z.string().max(140).describe("why, in a sentence the issuer will read"),
    },
  }, async ({ usdc: v, reason }) => {
    const r = await runtime.requestMore(capsuleId, usdc(v)!, reason);
    if (!r.ok) return { ...text(`Could not ask: ${r.reason}`), isError: true };
    return text(`Asked (nonce ${r.nonce}). The issuer sees it on the capsule page. Check valet_capsule for the answer, ` +
      `then valet_trade with approval_nonce ${r.nonce}.`);
  });

  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  // stderr only: stdout belongs to the protocol
  console.error(`[valet-mcp] ${(e as Error).message}`);
  process.exit(1);
});
