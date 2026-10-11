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
 * about how an action is signed. Every action resolves to whether it worked, so
 * a caller can tidy up after a success without guessing.
 */
export function useControls(onDone?: () => void) {
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; tone: "good" | "bad"; text: string } | null>(null);
  const valet = addresses.valet as Address;

  async function run(key: string, fn: () => Promise<void>, ok?: string): Promise<boolean> {
    setBusy(key);
    setMsg(null);
    try {
      if (!wallet) throw new Error("Sign in first.");
      await fn();
      if (ok) setMsg({ key, tone: "good", text: ok });
      onDone?.();
      return true;
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string };
      const declined = err.code === 4001 || /rejected|denied/i.test(err.message ?? "");
      setMsg({
        key, tone: "bad",
        text: declined ? "You declined it in your wallet. Nothing changed." : err.shortMessage ?? err.message ?? "That did not work.",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const provider = async () => (await wallet!.getEthereumProvider()) as EIP1193Provider;
  const deadline = async () => BigInt((await chainNow()) + 3600);
  const principalNonce = async (capsuleId: string) =>
    (await publicClient.readContract({
      address: valet, abi: valetAbi, functionName: "principalNonce", args: [BigInt(capsuleId)],
    })) as bigint;
  async function relay(path: string, body: Record<string, unknown>) {
    const r = await fetch(path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error ?? "The relayer refused it.");
  }

  /** choose who acts on it — the recipient, by signature */
  function claim(capsuleId: string, holder: Address, key: string, ok?: string) {
    return run(key, async () => {
      if (!/^0x[0-9a-fA-F]{40}$/.test(holder ?? "")) throw new Error("Choose who will act on it.");
      const d = await deadline();
      const signature = await signValet(await provider(), wallet!.address as Address, valet, "Claim", {
        capsuleId: BigInt(capsuleId), holder, nonce: await principalNonce(capsuleId), deadline: d,
      });
      await relay("/api/relay/claim", { capsuleId, holder, deadline: d.toString(), signature });
    }, ok);
  }

  /** pause/resume (action 0) or hand back (action 1) — the recipient, by signature */
  function principalAction(capsuleId: string, action: 0 | 1, value: boolean, key: string, ok?: string) {
    return run(key, async () => {
      const d = await deadline();
      const signature = await signValet(await provider(), wallet!.address as Address, valet, "PrincipalAction", {
        capsuleId: BigInt(capsuleId), action, value, nonce: await principalNonce(capsuleId), deadline: d,
      });
      await relay("/api/relay/principal", { capsuleId, action, value, deadline: d.toString(), signature });
    }, ok);
  }

  /** say yes to the agent's ask — the issuer, by signature, from a key the agent never holds */
  function approveEscalation(capsuleId: string, amount: bigint, nonce: bigint, key: string, ok?: string) {
    return run(key, async () => {
      const d = await deadline();
      const signature = await signValet(await provider(), wallet!.address as Address, valet, "Escalation", {
        capsuleId: BigInt(capsuleId), amount, nonce, deadline: d,
      });
      await relay("/api/relay/escalation", {
        capsuleId, amount: amount.toString(), nonce: nonce.toString(), deadline: d.toString(), signature,
      });
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

  return {
    busy, msg, claim, principalAction, approveEscalation, issuerTx,
    signedIn: !!wallet, me: wallet?.address as Address | undefined,
  };
}
