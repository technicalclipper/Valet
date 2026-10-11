import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEventLogs,
  type Address,
} from "viem";
import { serverAccount } from "../server/keys";
import { inTurn } from "../server/sender";
import { valetAbi } from "../chain/abi";
import { monad, publicClient } from "../chain/client";
import { ASSERTS, preflight, readBeneficiary, readCapsule, readHeadroom } from "../chain/reads";
import { addresses, chain as cfg, valetAddress } from "../config/chain";
import { amount } from "../format";
import { lastRun, publish, tryLock, unlock } from "./bus";
import type { AgentEvent } from "./types";

const kuruAbi = parseAbi([
  "function bestBidAsk() view returns (uint256, uint256)",
  "function placeAndExecuteMarketBuy(uint96 quoteSize, uint256 minOut, bool isMargin, bool isFOK) payable returns (uint256)",
]);

/**
 * The holder. Its key lives only on the server, in AGENT_PRIVATE_KEY, and it
 * can do exactly one thing with the capsule: call execute(). It cannot revoke,
 * pause, redirect, or move the vault — the contract's role split sees to that,
 * which is why handing it a key is a bounded act rather than a leap of faith.
 */
function agentAccount() {
  return serverAccount("AGENT_PRIVATE_KEY");
}

/**
 * What 5 USDC buys right now, from the top of Kuru's book.
 *
 * Checked against an eth_call of the real buy: amountIn * 1e28 / bestAsk
 * matched the actual fill to 0.000% for a 5 USDC order. It is the best price,
 * so a larger order that walks the book will fill a little worse — the
 * slippage floor absorbs that, and if it cannot, Kuru's fill-or-kill refuses,
 * which is an honest outcome rather than a bad fill.
 */
export async function quote(amountIn: bigint): Promise<{ out: bigint; ask: bigint }> {
  const [, ask] = await publicClient.readContract({
    address: addresses.kuruMarket,
    abi: kuruAbi,
    functionName: "bestBidAsk",
  });
  return { out: (amountIn * 10n ** 28n) / ask, ask };
}

function revertName(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return undefined;
  const d = reverted.data;
  if (d?.errorName === "Refused") return ASSERTS[Number(d.args?.[0])] ?? "Refused";
  return d?.errorName;
}

/**
 * One turn of the agent: wake, read, quote, floor, check, execute, settle.
 *
 * No artificial delays. On a fork every call returns in milliseconds, and
 * inventing waits here would make the data a performance rather than a record —
 * the console paces the animation on its own side.
 *
 * A refusal at preflight sends no transaction. The verdict is still the
 * chain's: preflight is an eth_call against the contract, and the run then
 * simulates execute() to show the revert the chain itself would return.
 */
export type Trigger = "wake" | "keeper" | "approval";

export async function runOnce(
  capsuleId: string,
  opts: { amountIn?: bigint; elevatedNonce?: bigint; trigger?: Trigger } = {},
) {
  if (!tryLock(capsuleId)) return { started: false, reason: "a run is already in progress" };

  const runId = `${capsuleId}-${Date.now().toString(36)}`;
  // Every event is also kept for the reply. On one long-lived server the
  // console hears them over SSE; on serverless the run and the stream can land
  // on different machines, so the caller's console plays them from the response.
  const events: AgentEvent[] = [];
  const say = (e: Omit<Parameters<typeof publish>[1], "runId">) => {
    const full = publish(capsuleId, { ...e, runId });
    events.push(full);
    return full;
  };
  const id = BigInt(capsuleId);

  try {
    const agent = agentAccount();
    const elevated = opts.elevatedNonce !== undefined;
    const trigger: Trigger = opts.trigger ?? (elevated ? "approval" : "wake");
    say({
      kind: "run-start",
      title: elevated
        ? "The issuer said yes — the agent spends under the approval"
        : trigger === "keeper"
          ? "A new window opened — the keeper wakes the agent, nobody pressed anything"
          : "The agent wakes",
      data: { agent: agent.address, trigger, ...(elevated ? { nonce: opts.elevatedNonce!.toString() } : {}) },
    });

    // --- wake
    say({ kind: "step", step: "wake", status: "active", title: "Checking the clock" });
    const head = await readHeadroom(id);
    const capsule = await readCapsule(id);
    const window = Number(head.windowIndex) + 1;
    say({
      kind: "step", step: "wake", status: "done",
      title: `Window ${window} of ${capsule.bounds.windows} is open`,
      detail: `${amount(head.windowLeft)} left today · ${amount(head.totalLeft)} left in total`,
      data: { window: String(window), windows: String(capsule.bounds.windows) },
    });

    // --- policy
    say({ kind: "step", step: "policy", status: "active", title: "Reading the permission from the chain" });
    const recipient = await readBeneficiary(id);
    const amountIn = opts.amountIn ?? capsule.bounds.perAction;
    const holderOk = capsule.holder.toLowerCase() === agent.address.toLowerCase();
    say({
      kind: "step", step: "policy", status: "done",
      title: holderOk ? "This agent holds the capsule" : "This agent is not the holder",
      detail: `${amount(capsule.bounds.perAction)} a day · hard cap ${amount(capsule.bounds.hardCap)} · proceeds to ${recipient.slice(0, 6)}…${recipient.slice(-4)}`,
      data: { amountIn: amountIn.toString(), perAction: capsule.bounds.perAction.toString(), hardCap: capsule.bounds.hardCap.toString(), recipient },
    });

    // --- quote
    say({ kind: "step", step: "quote", status: "active", title: `Asking Kuru what ${amount(amountIn)} buys` });
    const q = await quote(amountIn);
    const px = Number((q.ask * 10_000n) / 10n ** 16n) / 10_000;
    say({
      kind: "step", step: "quote", status: "done",
      title: `${amount(amountIn)} buys about ${amount(q.out, 18, "MON")}`,
      detail: `best ask ${px.toFixed(4)} USDC per MON, from the live book`,
      data: { quotedOut: q.out.toString(), price: px.toFixed(4) },
    });

    // --- floor
    // Rounded exactly as the contract rounds it. The first version used
    // floor(quote * 9900 / 10000), which lands one wei below the contract's
    // quote - floor(quote * 100 / 10000) whenever the division is inexact — so
    // the floor sat a hair outside the 1% bound and the nineteen checks refused
    // the agent's own trade as SLIPPAGE_TOO_WIDE. They were right to.
    const bps = capsule.bounds.maxSlippageBps;
    const minOut = q.out - (q.out * BigInt(bps)) / 10_000n;
    say({
      kind: "step", step: "floor", status: "done",
      title: `Will accept no less than ${amount(minOut, 18, "MON")}`,
      detail: `${bps / 100}% below the quote — the most the permission allows`,
      data: { minOut: minOut.toString(), bps: String(bps) },
    });

    // --- preflight
    const req = {
      capsuleId: id, vaultId: capsule.vaultId, amountIn,
      quotedOut: q.out, minOut, target: addresses.kuruMarket, recipient,
    };
    say({
      kind: "step", step: "preflight", status: "active",
      title: elevated
        ? "Asking the contract — with the soft caps lifted, and only those"
        : "Asking the contract whether this is allowed",
    });
    const verdict = await preflight(req, agent.address, elevated);

    const venueData = encodeFunctionData({
      abi: kuruAbi, functionName: "placeAndExecuteMarketBuy",
      args: [amountIn, minOut, false, true],
    });

    if (verdict !== "NONE") {
      // the chain's own words: simulate the real call and decode its revert
      let chainSays = verdict as string;
      try {
        await (elevated
          ? publicClient.simulateContract({
              address: valetAddress(), abi: valetAbi, functionName: "executeElevated",
              args: [req, venueData, opts.elevatedNonce!], account: agent.address,
            })
          : publicClient.simulateContract({
              address: valetAddress(), abi: valetAbi, functionName: "execute",
              args: [req, venueData], account: agent.address,
            }));
      } catch (err) {
        chainSays = revertName(err) ?? verdict;
      }
      say({
        kind: "step", step: "preflight", status: "refused", refusedBy: verdict,
        title: `Refused by the contract: ${verdict}`,
        detail: elevated && verdict === "OVER_HARD_CAP"
          ? "The issuer approved this, and the chain refuses it anyway: nothing lifts the hard cap. No transaction was sent, and nothing moved."
          : `execute() would revert with Refused(${verdict}). No transaction was sent, and nothing moved.`,
        data: { chainSays },
      });
      say({ kind: "run-end", outcome: "refused", refusedBy: verdict, title: "Nothing moved" });
      return { started: true, runId, outcome: "refused" as const, refusedBy: verdict, events };
    }

    say({ kind: "step", step: "preflight", status: "done", title: "All nineteen checks pass" });

    // --- execute
    say({ kind: "step", step: "execute", status: "active", title: "Sending the trade" });
    const wallet = createWalletClient({ account: agent, chain: monad, transport: http(cfg.rpcUrl) });
    const before = await publicClient.getBalance({ address: recipient });
    const hash = await inTurn(agent.address, () => elevated
      ? wallet.writeContract({
          address: valetAddress(), abi: valetAbi, functionName: "executeElevated",
          args: [req, venueData, opts.elevatedNonce!],
        })
      : wallet.writeContract({
          address: valetAddress(), abi: valetAbi, functionName: "execute", args: [req, venueData],
        }));
    say({ kind: "step", step: "execute", status: "done", title: "Submitted", txHash: hash, detail: hash });

    // --- settle
    say({ kind: "step", step: "settle", status: "active", title: "Waiting for the fill to land" });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`transaction reverted: ${hash}`);
    const ev = parseEventLogs({ abi: valetAbi, eventName: "Executed", logs: rcpt.logs })[0] as unknown as
      | { args: { received: bigint; beneficiary: Address } }
      | undefined;
    const after = await publicClient.getBalance({ address: recipient });
    const received = ev?.args.received ?? after - before;
    say({
      kind: "step", step: "settle", status: "done",
      title: `${amount(received, 18, "MON")} landed with the recipient`,
      detail: `in the same transaction as the trade · the agent held none of it`,
      txHash: hash,
      data: { received: received.toString(), recipient, gasUsed: rcpt.gasUsed.toString() },
    });
    say({ kind: "run-end", outcome: "executed", title: "Done until the next window", txHash: hash });
    return { started: true, runId, outcome: "executed" as const, txHash: hash, received: received.toString(), events };
  } catch (err) {
    const msg = err instanceof BaseError ? err.shortMessage : (err as Error).message;
    say({ kind: "run-end", outcome: "error", status: "error", title: "The run stopped", detail: msg });
    return { started: true, runId, outcome: "error" as const, error: msg, events };
  } finally {
    unlock(capsuleId);
  }
}

/**
 * The agent asks to exceed its per-action cap.
 *
 * It can ask; it can never approve. requestEscalation is the holder's, and the
 * agent pays for it, but the request moves no money and lifts nothing — it only
 * puts a question in front of the issuer, who answers by signing.
 *
 * Asking for more than the hard cap is allowed on purpose: the issuer should see
 * that the agent asked for something absurd, and the refusal belongs where the
 * hard cap is, at execution.
 */
export async function requestMore(capsuleId: string, size: bigint, reason: string) {
  if (!tryLock(capsuleId)) return { ok: false, reason: "a run is already in progress" };
  const runId = `${capsuleId}-ask-${Date.now().toString(36)}`;
  try {
    const agent = agentAccount();
    const id = BigInt(capsuleId);
    const wallet = createWalletClient({ account: agent, chain: monad, transport: http(cfg.rpcUrl) });
    const hash = await inTurn(agent.address, () => wallet.writeContract({
      address: valetAddress(), abi: valetAbi, functionName: "requestEscalation", args: [id, size, reason],
    }));
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    const ev = parseEventLogs({ abi: valetAbi, eventName: "EscalationRequested", logs: rcpt.logs })[0] as unknown as
      | { args: { nonce: bigint } }
      | undefined;
    const nonce = ev?.args.nonce ?? 0n;
    const asked = publish(capsuleId, {
      runId, kind: "ask", outcome: "requested", txHash: hash,
      title: `The agent asks to spend ${amount(size)} in one go — waiting for the issuer`,
      detail: reason,
      data: { amount: size.toString(), nonce: nonce.toString(), reason },
    });
    return { ok: true, nonce: nonce.toString(), hash, events: [asked] };
  } catch (err) {
    const msg = err instanceof BaseError ? err.shortMessage : (err as Error).message;
    return { ok: false, reason: msg };
  } finally {
    unlock(capsuleId);
  }
}

/**
 * Move a local fork forward in time, so day two can be shown without waiting
 * for day two. Only a fork accepts evm_increaseTime; on mainnet the RPC refuses
 * it, and the console's chain badge says "time accelerated" whenever this is
 * in play.
 */
export async function advanceTime(seconds: number): Promise<boolean> {
  if (cfg.isMainnet) return false;
  const rpc = (method: string, params: unknown[]) =>
    fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then((r) => r.json());
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine", []);
  return true;
}

export { lastRun };
