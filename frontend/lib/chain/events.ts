import type { Address } from "viem";
import { valetAbi } from "./abi";
import { publicClient } from "./client";
import { chain as cfg, valetAddress } from "../config/chain";

export interface HistoryEntry {
  kind: string;
  blockNumber: bigint;
  txHash: `0x${string}`;
  detail: Record<string, string>;
}

/**
 * History, rebuilt from the chain's own events rather than from anything we
 * wrote down. Both parties see the same list because it is not our list — and a
 * server that lied about a spend could not also produce the log entry for it.
 */
export async function readHistory(capsuleId: bigint, fromBlock = cfg.deployBlock): Promise<HistoryEntry[]> {
  const address = valetAddress();
  const named = ["Executed", "CapsuleMinted", "CapsuleClaimed", "CapsuleRevoked",
    "CapsuleSurrendered", "CapsulePaused", "CapsuleTightened", "ProceedsSwept",
    "EscalationRequested", "EscalationApproved", "EscalationConsumed"] as const;

  const events = valetAbi.filter(
    (e) => e.type === "event" && named.includes(e.name as (typeof named)[number]),
  );

  const batches = await Promise.all(
    events.map(async (event) => {
      try {
        return await publicClient.getLogs({
          address,
          event: event as never,
          args: { capsuleId } as never,
          fromBlock,
          toBlock: "latest",
        });
      } catch (cause) {
        // Do not return an empty list here. A range an RPC will not serve is a
        // configuration problem, and silently reporting "no history" would send
        // someone looking for a bug in the contract instead. Forks are the
        // common case: any range reaching back past the fork point makes anvil
        // ask upstream, which fails.
        throw new Error(
          `Could not read ${(event as { name: string }).name} logs from block ${fromBlock}. ` +
            `Set NEXT_PUBLIC_DEPLOY_BLOCK to the block Valet was deployed at — ` +
            `ranges that predate a fork's start are not servable.`,
          { cause },
        );
      }
    }),
  );

  const out: HistoryEntry[] = [];
  for (const logs of batches) {
    for (const log of logs as never[]) {
      const l = log as unknown as {
        eventName: string; blockNumber: bigint; transactionHash: `0x${string}`;
        args: Record<string, unknown>;
      };
      const detail: Record<string, string> = {};
      for (const [k, v] of Object.entries(l.args ?? {})) {
        if (k === "capsuleId") continue;
        detail[k] = typeof v === "bigint" ? v.toString() : String(v);
      }
      out.push({ kind: l.eventName, blockNumber: l.blockNumber, txHash: l.transactionHash, detail });
    }
  }

  return out.sort((a, b) =>
    a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1,
  );
}

/** What a spend actually did, for the console. */
export async function readExecutions(capsuleId: bigint, fromBlock = cfg.deployBlock) {
  const logs = await publicClient.getLogs({
    address: valetAddress(),
    event: valetAbi.find((e) => e.type === "event" && e.name === "Executed") as never,
    args: { capsuleId } as never,
    fromBlock,
    toBlock: "latest",
  });
  return (logs as never[]).map((log) => {
    const l = log as unknown as {
      blockNumber: bigint; transactionHash: `0x${string}`;
      args: { holder: Address; target: Address; amountIn: bigint; received: bigint; beneficiary: Address };
    };
    return {
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      holder: l.args.holder,
      target: l.args.target,
      amountIn: l.args.amountIn,
      received: l.args.received,
      beneficiary: l.args.beneficiary,
    };
  });
}
