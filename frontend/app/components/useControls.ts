"use client";

import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { valetAbi } from "../../lib/chain/abi";
import { monad, publicClient } from "../../lib/chain/client";
import { chain as cfg, addresses } from "../../lib/config/chain";
import { chainNow } from "../../lib/chain/writes";
import { signValet } from "../../lib/privy/sign";

/**
 * The two ways a person changes a capsule, in one place.
 *
 * The recipient signs and the relayer submits, so they never need gas. The
 * issuer sends ordinary transactions — they funded the capsule and hold MON.
 * Shared by the capsule page and the dashboard so the two can never disagree
 * about how an action is signed.
 */
export function useControls(onDone?: () => void) {
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; tone: "good" | "bad"; text: string } | null>(null);
  const valet = addresses.valet as Address;

  async function run(key: string, fn: () => Promise<void>, ok?: string) {
    setBusy(key);
    setMsg(null);
    try {
      if (!wallet) throw new Error("Sign in first.");
      await fn();
      if (ok) setMsg({ key, tone: "good", text: ok });
      onDone?.();
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string };
      const declined = err.code === 4001 || /rejected|denied/i.test(err.message ?? "");
      setMsg({
        key, tone: "bad",
        text: declined ? "You declined it in your wallet. Nothing changed." : err.shortMessage ?? err.message ?? "That did not work.",
      });
    } finally {
      setBusy(null);
    }
  }

  const provider = async () => (await wallet!.getEthereumProvider()) as EIP1193Provider;

  /** pause/resume (action 0) or hand back (action 1) — the recipient, by signature */
  function principalAction(capsuleId: string, action: 0 | 1, value: boolean, key: string, ok?: string) {
    return run(key, async () => {
      const deadline = BigInt((await chainNow()) + 3600);
      const nonce = (await publicClient.readContract({
        address: valet, abi: valetAbi, functionName: "principalNonce", args: [BigInt(capsuleId)],
      })) as bigint;
      const signature = await signValet(await provider(), wallet!.address as Address, valet, "PrincipalAction", {
        capsuleId: BigInt(capsuleId), action, value, nonce, deadline,
      });
      const r = await fetch("/api/relay/principal", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ capsuleId, action, value, deadline: deadline.toString(), signature }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error ?? "The relayer refused it.");
    }, ok);
  }

  /** pause, revoke, revoke-and-return — the issuer, by transaction */
  function issuerTx(fn: "revoke" | "setPausedByIssuer" | "revokeVaultAndSweep", args: readonly unknown[], key: string, ok?: string) {
    return run(key, async () => {
      const w = createWalletClient({ account: wallet!.address as Address, chain: monad, transport: custom(await provider()) });
      await w.switchChain({ id: cfg.id }).catch(() => {});
      const hash = await w.writeContract({ address: valet, abi: valetAbi, functionName: fn, args: args as never });
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") throw new Error("The transaction reverted.");
    }, ok);
  }

  return { busy, msg, principalAction, issuerTx, signedIn: !!wallet, me: wallet?.address as Address | undefined };
}
