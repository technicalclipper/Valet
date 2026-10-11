import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEventLogs, type Address } from "viem";
import { valetAbi } from "./abi";
import { publicClient } from "./client";
import { chain as cfg, valetAddress } from "../config/chain";
import { fromJson as dec, toJson as enc } from "../json";

/**
 * Every event Valet has emitted, held by the server.
 *
 * Monad's public RPC serves eth_getLogs a hundred blocks at a time — about forty
 * seconds of chain. Asking it for a capsule's history from the deploy block
 * fails a minute after deploying. So the server reads the contract's logs once,
 * in ranges the RPC will serve, keeps them, and catches up from where it left
 * off; every page and the keeper read from here instead of from the RPC.
 *
 * Still the chain's own record, not ours: nothing is written here that did not
 * come from a log, and the file on disk is only a cache — delete it and the
 * index rebuilds from the deploy block, to the same contents.
 */
export interface IndexedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}`;
}

interface Index { address: string; next: bigint; logs: IndexedLog[]; syncedAt: number; syncing?: Promise<void> }

/** blocks per eth_getLogs: 100 is Monad's public limit; a local fork takes far more */
const RANGE = BigInt(process.env.LOG_RANGE ?? (cfg.isMainnet ? 100 : 10_000));
const PARALLEL = Number(process.env.LOG_PARALLEL ?? 6);
const FRESH_MS = 1_500;

const file = () => join(process.cwd(), "data", "index", `${cfg.id}-${valetAddress().toLowerCase()}.json`);


const g = globalThis as unknown as { __valetIndex?: Index };

function index(): Index {
  const address = valetAddress().toLowerCase();
  if (g.__valetIndex?.address === address) return g.__valetIndex;
  let saved: { next: bigint; logs: IndexedLog[] } | undefined;
  try {
    if (existsSync(file())) saved = dec(readFileSync(file(), "utf8"));
  } catch { /* a bad cache is rebuilt, not trusted */ }
  return (g.__valetIndex = {
    address, next: saved?.next ?? cfg.deployBlock, logs: saved?.logs ?? [], syncedAt: 0,
  });
}

function save(ix: Index) {
  try {
    mkdirSync(join(process.cwd(), "data", "index"), { recursive: true });
    writeFileSync(`${file()}.tmp`, enc({ next: ix.next, logs: ix.logs }));
    renameSync(`${file()}.tmp`, file());
  } catch { /* read-only disks still work, from memory */ }
}

async function fetchRange(from: bigint, to: bigint): Promise<IndexedLog[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await publicClient.getLogs({ address: valetAddress() as Address, fromBlock: from, toBlock: to });
      return parseEventLogs({ abi: valetAbi, logs: raw }).map((l) => ({
        eventName: l.eventName,
        args: l.args as Record<string, unknown>,
        blockNumber: l.blockNumber,
        logIndex: l.logIndex,
        transactionHash: l.transactionHash,
      }));
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

async function catchUp(ix: Index) {
  const head = await publicClient.getBlockNumber();
  while (ix.next <= head) {
    // a batch of ranges in parallel, appended in block order
    const ranges: [bigint, bigint][] = [];
    for (let from = ix.next; from <= head && ranges.length < PARALLEL; from += RANGE) {
      const to = from + RANGE - 1n < head ? from + RANGE - 1n : head;
      ranges.push([from, to]);
    }
    const got = await Promise.all(ranges.map(([f, t]) => fetchRange(f, t)));
    for (const logs of got) ix.logs.push(...logs);
    ix.next = ranges[ranges.length - 1][1] + 1n;
  }
  ix.syncedAt = Date.now();
  save(ix);
}

/** Bring the index up to the chain head, once at a time however many callers ask. */
export async function sync(): Promise<void> {
  const ix = index();
  if (Date.now() - ix.syncedAt < FRESH_MS) return;
  ix.syncing ??= catchUp(ix).finally(() => { ix.syncing = undefined; });
  return ix.syncing;
}

/** Logs matching an event name and indexed arguments, oldest first, after a sync. */
export async function logs(filter: { eventName?: string | string[]; args?: Record<string, unknown>; afterBlock?: bigint } = {}) {
  await sync();
  const names = filter.eventName === undefined ? undefined : new Set([filter.eventName].flat());
  const want = Object.entries(filter.args ?? {});
  const same = (a: unknown, b: unknown) =>
    typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
  return index().logs.filter((l) =>
    (!names || names.has(l.eventName)) &&
    (filter.afterBlock === undefined || l.blockNumber > filter.afterBlock) &&
    want.every(([k, v]) => (Array.isArray(v) ? v.some((x) => same(l.args[k], x)) : same(l.args[k], v))),
  );
}

/** How far the index has read, for anyone who needs to say "as of block N". */
export function indexedThrough(): bigint {
  return index().next - 1n;
}
