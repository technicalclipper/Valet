import { BaseError, ContractFunctionRevertedError, createWalletClient, http } from "viem";
import { valetAbi } from "../chain/abi";
import { monad, publicClient } from "../chain/client";
import { chain as cfg, valetAddress } from "../config/chain";
import { serverAccount } from "./keys";
import { inTurn } from "./sender";

type RelayFn = "claimBySignature" | "principalActionBySignature" | "approveEscalation";

/**
 * Submit someone's signature to the contract and pay for it.
 *
 * The relayer has no authority of its own. Every one of these functions checks
 * the signature against the capsule's issuer or principal on chain, so the
 * worst a compromised relayer can do is refuse to submit — it cannot forge a
 * claim, a pause or an approval. That is what makes it safe to leave the
 * endpoints open.
 *
 * Simulated first, so a bad or stale signature is rejected for free rather than
 * reverting on chain and costing gas. Also how a replayed signature is turned
 * away: the nonce has already moved on, and the simulation says so.
 */
export async function relay(fn: RelayFn, args: readonly unknown[]) {
  const account = serverAccount("RELAYER_PRIVATE_KEY");
  try {
    await publicClient.simulateContract({
      address: valetAddress(), abi: valetAbi, functionName: fn, args: args as never, account,
    });
  } catch (err) {
    return { ok: false as const, error: explain(err) };
  }
  const wallet = createWalletClient({ account, chain: monad, transport: http(cfg.rpcUrl) });
  const hash = await inTurn(account.address, () => wallet.writeContract({
    address: valetAddress(), abi: valetAbi, functionName: fn, args: args as never,
  }));
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") return { ok: false as const, error: "reverted on chain", hash };
  return { ok: true as const, hash, gasUsed: rcpt.gasUsed.toString() };
}

function explain(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError && r.data?.errorName) {
      const name = r.data.errorName;
      const human: Record<string, string> = {
        BadSignature: "The signature does not match the person allowed to make this change.",
        AlreadyClaimed: "This capsule has already been claimed.",
        PastDeadline: "The signature expired. Sign again.",
        NotRequested: "There is no such escalation request.",
        AlreadyApproved: "That escalation is already approved.",
        NoSuchCapsule: "There is no such capsule.",
        UnknownAction: "Unknown action.",
      };
      return human[name] ?? name;
    }
    return err.shortMessage;
  }
  return (err as Error).message;
}

export function relayerAddress(): string {
  return serverAccount("RELAYER_PRIVATE_KEY").address;
}
