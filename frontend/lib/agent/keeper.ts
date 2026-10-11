import { parseAbiItem, type Address } from "viem";
import { publicClient } from "../chain/client";
import { preflight, readBeneficiary, readCapsule, readHeadroom } from "../chain/reads";
import { addresses, chain as cfg, valetAddress } from "../config/chain";
import { serverAccount } from "../server/keys";
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
const claimed = parseAbiItem(
  "event CapsuleClaimed(uint256 indexed capsuleId, address indexed holder, address indexed by)",
);

interface State {
  /** capsule id → the window index it was claimed in */
  held: Map<string, bigint>;
  /** next block to scan for claims */
  cursor: bigint;
  /** `${id}:${window}` → when we last found it refused, so we do not ask every tick */
  quiet: Map<string, number>;
  ticking: boolean;
}
const g = globalThis as unknown as { __valetKeeper?: State };
const state = (g.__valetKeeper ??= { held: new Map(), cursor: cfg.deployBlock, quiet: new Map(), ticking: false });

const RETRY_REFUSED_MS = 5 * 60_000;
const SCAN_CHUNK = 5_000n;

export interface TickResult {
  /** another tick was already running, so this one looked at nothing */
  busy?: true;
  watched: number;
  started: string[];
  skipped: Record<string, string>;
}

/** New claims to the agent since the last scan, in chunks an RPC will serve. */
async function scanClaims(agent: Address) {
  const head = await publicClient.getBlockNumber();
  while (state.cursor <= head) {
    const to = state.cursor + SCAN_CHUNK - 1n < head ? state.cursor + SCAN_CHUNK - 1n : head;
    const logs = await publicClient.getLogs({
      address: valetAddress(), event: claimed, args: { holder: agent }, fromBlock: state.cursor, toBlock: to,
    });
    for (const l of logs) {
      const id = l.args.capsuleId!.toString();
      const c = await readCapsule(l.args.capsuleId!);
      const at = (await publicClient.getBlock({ blockNumber: l.blockNumber })).timestamp;
      const b = c.bounds;
      const idx = at < b.notBefore ? -1n : (at - b.notBefore) / b.windowLength;
      state.held.set(id, idx);
    }
    state.cursor = to + 1n;
  }
}

export async function tick(): Promise<TickResult> {
  const out: TickResult = { watched: 0, started: [], skipped: {} };
  if (state.ticking) return { ...out, busy: true };
  state.ticking = true;
  try {
    const agent = serverAccount("AGENT_PRIVATE_KEY");
    await scanClaims(agent.address);
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
