import type { Address } from "viem";
import { publicClient } from "../chain/client";
import { preflight, readBeneficiary, readCapsule, readHeadroom } from "../chain/reads";
import { indexedThrough, logs } from "../chain/eventIndex";
import { addresses, chain as cfg } from "../config/chain";
import { serverAccount } from "../server/keys";
import { amount } from "../format";
import { publish } from "./bus";
import { quote, runOnce } from "./runtime";

/**
 * The keeper: the agent trading on schedule, with nobody watching.
 *
 * Every tick it looks at each capsule the managed agent holds and asks one
 * question — is there a window open that has not been traded in yet? If so it
 * asks the contract, quietly, whether the trade would pass, and only then wakes
 * the agent, so a paused or emptied capsule costs a few reads and never a
 * transaction or a refusal in the console.
 *
 * It starts from the window after the claim. The window a capsule is claimed in
 * belongs to whoever claimed it — they can wake the agent by hand, and the
 * keeper will not race them for it. That also makes the rule restart-proof: it
 * is computed from the claim's block on chain, not from anything held here.
 *
 * It decides nothing the contract does not. Every run it starts goes through the
 * same nineteen checks as a press of the button; the keeper only chooses when.
 */

interface State {
  /** capsule id → the window index it was claimed in */
  held: Map<string, bigint>;
  /** next block to look at for claims */
  cursor: bigint;
  /** next block to scan for trades by agents we did not write; unset until the first tick */
  outsideCursor?: bigint;
  /** `${id}:${window}` → when we last found it refused, so we do not ask every tick */
  quiet: Map<string, number>;
  ticking: boolean;
}
const g = globalThis as unknown as { __valetKeeper?: State };
const state: State = (g.__valetKeeper ??= { held: new Map(), cursor: cfg.deployBlock, quiet: new Map(), ticking: false });

const RETRY_REFUSED_MS = 5 * 60_000;

export interface TickResult {
  /** another tick was already running, so this one looked at nothing */
  busy?: true;
  watched: number;
  started: string[];
  skipped: Record<string, string>;
}

/** New claims to the agent since the last look, from the server's event index. */
async function scanClaims(agent: Address) {
  const found = await logs({ eventName: "CapsuleClaimed", args: { holder: agent }, afterBlock: state.cursor - 1n });
  // read now, before any await below lets another sync move the index on
  const through = indexedThrough();
  for (const l of found) {
    const cid = l.args.capsuleId as bigint;
    const c = await readCapsule(cid);
    const at = (await publicClient.getBlock({ blockNumber: l.blockNumber })).timestamp;
    const b = c.bounds;
    state.held.set(cid.toString(), at < b.notBefore ? -1n : (at - b.notBefore) / b.windowLength);
  }
  state.cursor = through + 1n;
}

/**
 * Trades by agents Valet did not write — an MCP client, a script, anything
 * holding a capsule — happen without this server, so they never reach the
 * console on their own. They do reach the chain. Each Executed event from a
 * holder other than the managed agent is replayed into that capsule's console,
 * so issuer and recipient watch an outside agent the same way they watch ours.
 * Starts from the first tick, not from the deploy block: this is a live feed,
 * and history is already on the capsule page.
 */
async function announceOutsiders(agent: Address) {
  if (state.outsideCursor === undefined) {
    state.outsideCursor = indexedThrough() + 1n;
    return;
  }
  const found = await logs({ eventName: "Executed", afterBlock: state.outsideCursor - 1n });
  state.outsideCursor = indexedThrough() + 1n;
  for (const l of found) {
    const a = l.args as { capsuleId: bigint; holder: Address; amountIn: bigint; received: bigint; beneficiary: Address };
    if (a.holder!.toLowerCase() === agent.toLowerCase()) continue;
    const cid = a.capsuleId!.toString();
    const runId = `${cid}-outside-${l.transactionHash.slice(2, 10)}`;
    const say = (e: Omit<Parameters<typeof publish>[1], "runId">) => publish(cid, { ...e, runId });
    const who = `${a.holder!.slice(0, 6)}…${a.holder!.slice(-4)}`;
    say({ kind: "run-start", title: `An outside agent traded — ${who}, one Valet never wrote`, data: { trigger: "outside", agent: a.holder! } });
    say({
      kind: "step", step: "policy", status: "done", title: "It holds the capsule, and nothing more",
      detail: "the same permission, read from the same chain",
      data: { amountIn: a.amountIn!.toString(), recipient: a.beneficiary! },
    });
    say({ kind: "step", step: "preflight", status: "done", title: "All nineteen checks passed, inside its own transaction" });
    say({ kind: "step", step: "execute", status: "done", title: `Spent ${amount(a.amountIn!)} on Kuru`, txHash: l.transactionHash, detail: l.transactionHash });
    say({
      kind: "step", step: "settle", status: "done",
      title: `${amount(a.received!, 18, "MON")} landed with the recipient`,
      detail: "read back from the chain's Executed event — this server never touched the trade",
      txHash: l.transactionHash,
      data: { received: a.received!.toString(), recipient: a.beneficiary! },
    });
    say({ kind: "run-end", outcome: "executed", title: "Every limit held for it too", txHash: l.transactionHash });
  }
}

export async function tick(): Promise<TickResult> {
  const out: TickResult = { watched: 0, started: [], skipped: {} };
  if (state.ticking) return { ...out, busy: true };
  state.ticking = true;
  try {
    const agent = serverAccount("AGENT_PRIVATE_KEY");
    await scanClaims(agent.address);
    await announceOutsiders(agent.address);
    const now = BigInt((await publicClient.getBlock()).timestamp);

    for (const [id, claimWindow] of state.held) {
      out.watched++;
      const skip = (why: string) => (out.skipped[id] = why);
      const c = await readCapsule(BigInt(id));
      const b = c.bounds;

      if (c.holder.toLowerCase() !== agent.address.toLowerCase()) { skip("no longer held by the agent"); continue; }
      if (c.revoked || c.surrendered) { state.held.delete(id); skip("ended"); continue; }
      if (now >= b.expiresAt) { state.held.delete(id); skip("expired"); continue; }
      if (c.pausedByIssuer || c.pausedByPrincipal) { skip("paused"); continue; }
      if (now < b.notBefore) { skip("not started"); continue; }

      const idx = (now - b.notBefore) / b.windowLength;
      if (idx >= BigInt(b.windows)) { skip("every window used"); continue; }
      if (idx <= claimWindow) { skip("the claim window is the claimer's"); continue; }
      if (BigInt(c.lastWindowIndex) === idx && c.spentInWindow > 0n) { skip("already traded this window"); continue; }

      const key = `${id}:${idx}`;
      const last = state.quiet.get(key);
      if (last && Date.now() - last < RETRY_REFUSED_MS) { skip("refused recently"); continue; }

      // ask the contract before waking anyone: the same request runOnce will build
      const head = await readHeadroom(BigInt(id));
      const amountIn = b.perAction < head.windowLeft ? b.perAction : head.windowLeft;
      const q = await quote(amountIn);
      const minOut = q.out - (q.out * BigInt(b.maxSlippageBps)) / 10_000n;
      const verdict = await preflight({
        capsuleId: BigInt(id), vaultId: c.vaultId, amountIn, quotedOut: q.out, minOut,
        target: addresses.kuruMarket, recipient: await readBeneficiary(BigInt(id)),
      }, agent.address);
      if (verdict !== "NONE") { state.quiet.set(key, Date.now()); skip(`would be refused: ${verdict}`); continue; }

      const r = await runOnce(id, { amountIn, trigger: "keeper" });
      if (r.started) out.started.push(id);
      else skip(r.reason ?? "busy");
    }
    return out;
  } finally {
    state.ticking = false;
  }
}

/**
 * Run the keeper inside this server, every KEEPER_INTERVAL_MS (15s by default;
 * 0 turns it off). Right for one long-lived server; on serverless, call
 * /api/keeper/tick from a cron instead.
 */
export function startKeeper() {
  const every = Number(process.env.KEEPER_INTERVAL_MS ?? 15_000);
  const h = globalThis as unknown as { __valetKeeperTimer?: ReturnType<typeof setInterval> };
  if (!every || h.__valetKeeperTimer || !addresses.valet || !process.env.AGENT_PRIVATE_KEY) return;
  h.__valetKeeperTimer = setInterval(() => {
    tick().catch((e) => console.warn(`[keeper] ${(e as Error).message}`));
  }, every);
  console.log(`[keeper] watching the agent's capsules every ${every / 1000}s`);
}
