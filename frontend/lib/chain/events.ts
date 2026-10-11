import type { Address } from "viem";
import { chain as cfg } from "../config/chain";
import { logs } from "./eventIndex";

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
 *
 * Read through the server's event index, which fetches logs in ranges the RPC
 * will serve. Server-only for that reason.
 */
export async function readHistory(capsuleId: bigint, fromBlock = cfg.deployBlock): Promise<HistoryEntry[]> {
  const named = ["Executed", "CapsuleMinted", "CapsuleClaimed", "CapsuleRevoked",
    "CapsuleSurrendered", "CapsulePaused", "CapsuleTightened", "ProceedsSwept",
    "EscalationRequested", "EscalationApproved", "EscalationConsumed"];
  const found = await logs({ eventName: named, args: { capsuleId }, afterBlock: fromBlock - 1n });
  return found.map((l) => {
    const detail: Record<string, string> = {};
    for (const [k, v] of Object.entries(l.args ?? {})) {
      if (k === "capsuleId") continue;
      detail[k] = typeof v === "bigint" ? v.toString() : String(v);
    }
    return { kind: l.eventName, blockNumber: l.blockNumber, txHash: l.transactionHash, detail };
  });
}

/** What a spend actually did, for the console. */
export async function readExecutions(capsuleId: bigint, fromBlock = cfg.deployBlock) {
  const found = await logs({ eventName: "Executed", args: { capsuleId }, afterBlock: fromBlock - 1n });
  return found.map((l) => {
    const a = l.args as { holder: Address; target: Address; amountIn: bigint; received: bigint; beneficiary: Address };
    return {
      blockNumber: l.blockNumber,
      txHash: l.transactionHash,
      holder: a.holder,
      target: a.target,
      amountIn: a.amountIn,
      received: a.received,
      beneficiary: a.beneficiary,
    };
  });
}
