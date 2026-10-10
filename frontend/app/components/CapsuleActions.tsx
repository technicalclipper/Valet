"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, parseAbiItem, type Address, type EIP1193Provider } from "viem";
import { valetAbi } from "../../lib/chain/abi";
import { monad, publicClient } from "../../lib/chain/client";
import { chain as cfg } from "../../lib/config/chain";
import { chainNow } from "../../lib/chain/writes";
import { signValet } from "../../lib/privy/sign";
import { amount } from "../../lib/format";

const ZERO = "0x0000000000000000000000000000000000000000";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface Props {
  capsuleId: string;
  valet: Address;
  issuer: Address;
  principal: Address;
  holder: Address;
  pausedByIssuer: boolean;
  pausedByPrincipal: boolean;
  ended: boolean;
  vaultId: string;
  hardCap: string;
}

/**
 * What you can do with this capsule, decided by who you are signed in as.
 *
 * The recipient never sends a transaction: claiming, pausing and handing back
 * are signatures the relayer submits, so someone who has never held a token can
 * do all of it. The issuer's controls are ordinary transactions — they funded
 * the capsule, so they have gas — except approving an escalation, which is a
 * signature too, so it can be done from a wallet the agent cannot reach.
 */
export function CapsuleActions(p: Props) {
  const router = useRouter();
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const me = wallet?.address?.toLowerCase();
  const isIssuer = !!me && me === p.issuer.toLowerCase();
  const isPrincipal = !!me && me === p.principal.toLowerCase();
  const unclaimed = p.holder === ZERO;

  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [agent, setAgent] = useState<Address | null>(null);
  const [holderChoice, setHolderChoice] = useState<"agent" | "other">("agent");
  const [otherHolder, setOtherHolder] = useState("");
  const [ask, setAsk] = useState<{ nonce: bigint; amount: bigint; reason: string } | null>(null);

  useEffect(() => {
    void fetch("/api/agent/info").then((r) => r.json()).then((d) => d.address && setAgent(d.address));
  }, []);

  /** The issuer watches for the agent asking, so the request appears without a reload. */
  const pollAsk = useCallback(async () => {
    if (!isIssuer || p.ended) return;
    const id = BigInt(p.capsuleId);
    const next = (await publicClient.readContract({
      address: p.valet, abi: valetAbi, functionName: "escalationNonce", args: [id],
    })) as bigint;
    if (next === 0n) return setAsk(null);
    const nonce = next - 1n;
    const e = (await publicClient.readContract({
      address: p.valet, abi: valetAbi, functionName: "getEscalation", args: [id, nonce],
    })) as unknown as { requestedAmount: bigint; requested: boolean; approved: boolean; consumed: boolean };
    if (!e.requested || e.approved || e.consumed) return setAsk(null);
    const logs = await publicClient.getLogs({
      address: p.valet,
      event: parseAbiItem("event EscalationRequested(uint256 indexed capsuleId, uint256 indexed nonce, uint256 amount, string reason)"),
      args: { capsuleId: id, nonce },
      fromBlock: cfg.deployBlock,
    }).catch(() => []);
    setAsk({ nonce, amount: e.requestedAmount, reason: (logs[0]?.args.reason as string) ?? "" });
  }, [isIssuer, p.capsuleId, p.valet, p.ended]);

  useEffect(() => {
    void pollAsk();
    const t = setInterval(() => void pollAsk(), 3000);
    return () => clearInterval(t);
  }, [pollAsk]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      const err = e as { code?: number; shortMessage?: string; message?: string };
      const declined = err.code === 4001 || /rejected|denied/i.test(err.message ?? "");
      setMsg({ tone: "bad", text: declined ? "You declined it in your wallet. Nothing changed." : err.shortMessage ?? err.message ?? "That did not work." });
    } finally {
      setBusy(null);
    }
  }

  async function provider() {
    return (await wallet!.getEthereumProvider()) as EIP1193Provider;
  }
  async function deadline() {
    return BigInt((await chainNow()) + 3600);
  }
  async function principalNonce() {
    return (await publicClient.readContract({
      address: p.valet, abi: valetAbi, functionName: "principalNonce", args: [BigInt(p.capsuleId)],
    })) as bigint;
  }
  async function relay(path: string, body: Record<string, unknown>) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json());
    if (!r.ok) throw new Error(r.error ?? "The relayer refused it.");
  }

  // --- the recipient, by signature -------------------------------------------
  const claim = () => act("claim", async () => {
    const holder = (holderChoice === "agent" ? agent : otherHolder.trim()) as Address;
    if (!holder || !/^0x[0-9a-fA-F]{40}$/.test(holder)) throw new Error("Choose who will act on it.");
    const d = await deadline();
    const signature = await signValet(await provider(), wallet!.address as Address, p.valet, "Claim", {
      capsuleId: BigInt(p.capsuleId), holder, nonce: await principalNonce(), deadline: d,
    });
    await relay("/api/relay/claim", { capsuleId: p.capsuleId, holder, deadline: d.toString(), signature });
    setMsg({ tone: "good", text: "Claimed. The agent can act from the next window — and you paid nothing." });
  });

  const principalAction = (action: 0 | 1, value: boolean, label: string) => act(label, async () => {
    const d = await deadline();
    const signature = await signValet(await provider(), wallet!.address as Address, p.valet, "PrincipalAction", {
      capsuleId: BigInt(p.capsuleId), action, value, nonce: await principalNonce(), deadline: d,
    });
    await relay("/api/relay/principal", { capsuleId: p.capsuleId, action, value, deadline: d.toString(), signature });
  });

  // --- the issuer -----------------------------------------------------------
  const issuerTx = (fn: "revoke" | "setPausedByIssuer" | "revokeVaultAndSweep", args: readonly unknown[], label: string) =>
    act(label, async () => {
      const w = createWalletClient({ account: wallet!.address as Address, chain: monad, transport: custom(await provider()) });
      await w.switchChain({ id: cfg.id }).catch(() => {});
      const hash = await w.writeContract({ address: p.valet, abi: valetAbi, functionName: fn, args: args as never });
      await publicClient.waitForTransactionReceipt({ hash });
    });

  const approve = () => act("approve", async () => {
    if (!ask) return;
    const d = await deadline();
    const signature = await signValet(await provider(), wallet!.address as Address, p.valet, "Escalation", {
      capsuleId: BigInt(p.capsuleId), amount: ask.amount, nonce: ask.nonce, deadline: d,
    });
    await relay("/api/relay/escalation", {
      capsuleId: p.capsuleId, amount: ask.amount.toString(), nonce: ask.nonce.toString(), deadline: d.toString(), signature,
    });
    setAsk(null);
    setMsg({ tone: "good", text: "Approved. Watch the console — the agent spends it now, or the hard cap refuses it." });
  });

  // --- render ---------------------------------------------------------------
  if (p.ended) return null;

  const Btn = ({ onClick, label, tone = "dark", disabled }: { onClick: () => void; label: string; tone?: "dark" | "line" | "bad"; disabled?: boolean }) => (
    <button
      onClick={onClick}
      disabled={!!busy || disabled}
      className="rounded-full border-2 px-4 py-2 text-sm font-semibold transition disabled:opacity-40"
      style={
        tone === "dark" ? { background: "#16161a", borderColor: "#16161a", color: "#fdfcff" }
          : tone === "bad" ? { borderColor: "#d8366f", color: "#b5245a" }
            : { borderColor: "rgb(22 22 26 / 0.2)", color: "#16161a" }
      }
    >
      {busy === label ? "…" : label}
    </button>
  );

  const note = msg && (
    <p className="mt-3 text-[12px]" style={{ color: msg.tone === "good" ? "#1f7a46" : "#b5245a" }}>{msg.text}</p>
  );

  // the agent is asking, and you are the one who can say yes
  const escalationCard = isIssuer && ask && (
    <section className="card-pop card-enter p-5" style={{ ["--pop" as string]: "#d8366f" }}>
      <p className="eyebrow">the agent is asking</p>
      <h3 className="mt-1 text-lg font-semibold on-card">
        Spend {amount(ask.amount)} in one go?
      </h3>
      {ask.reason && <p className="mt-1 text-[13px] on-card-dim">“{ask.reason}”</p>}
      {ask.amount > BigInt(p.hardCap) ? (
        <p className="mt-2 text-[13px]" style={{ color: "#b5245a" }}>
          This is over the hard cap of {amount(BigInt(p.hardCap))}. You can approve it — and the chain will
          still refuse it, because nothing lifts the hard cap. Approve it to see that.
        </p>
      ) : (
        <p className="mt-2 text-[13px] on-card-dim">
          Over the per-action cap, under the hard cap of {amount(BigInt(p.hardCap))}. Approving lifts the soft
          caps for this one spend and nothing else.
        </p>
      )}
      <p className="mt-2 text-[11px] on-card-faint">
        You sign; the relayer submits. The agent can ask, but only your key can approve — and it is a key
        the agent never holds.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn onClick={approve} label="Approve with my signature" />
      </div>
      {note}
    </section>
  );

  if (unclaimed) {
    if (!isPrincipal && !isIssuer) {
      return (
        <section className="card-pop p-5" style={{ ["--pop" as string]: "#7e65d4" }}>
          <h3 className="text-base font-semibold on-card">Waiting to be claimed</h3>
          <p className="mt-1 text-[13px] on-card-dim">
            This capsule is for <span className="font-mono on-card">{short(p.principal)}</span>. Until they
            choose who acts on it, nothing can be spent.
          </p>
          {!authenticated ? (
            <div className="mt-3"><Btn onClick={login} label="Sign in — is it yours?" /></div>
          ) : (
            <p className="mt-2 text-[12px] on-card-faint">
              You are signed in as {short(me ?? ZERO)}. If you were given this by email, sign in with that
              email address — by email, not Google — to reach the wallet made for you.
            </p>
          )}
        </section>
      );
    }
    return (
      <section className="card-pop card-enter p-5" style={{ ["--pop" as string]: "#2f9e5e" }}>
        <p className="eyebrow">{isPrincipal ? "this is for you" : "you issued this"}</p>
        <h3 className="mt-1 text-lg font-semibold on-card">Choose who acts on it</h3>
        <p className="mt-1 text-[13px] on-card-dim">
          Whoever you pick can execute inside the limits and do nothing else — not pause it, not redirect it,
          not touch the vault. You sign once; it costs you nothing.
        </p>
        <div className="mt-3 space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="radio" checked={holderChoice === "agent"} onChange={() => setHolderChoice("agent")} className="mt-1" />
            <span>
              <span className="font-semibold on-card">Valet&apos;s agent</span>
              <span className="on-card-faint"> — trades on schedule; you watch it in the console. {agent && <span className="font-mono">{short(agent)}</span>}</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
            <input type="radio" checked={holderChoice === "other"} onChange={() => setHolderChoice("other")} className="mt-1" />
            <span className="w-full">
              <span className="font-semibold on-card">Another agent or key</span>
              <span className="on-card-faint"> — one we never wrote; every limit holds the same.</span>
              {holderChoice === "other" && (
                <input
                  value={otherHolder}
                  onChange={(e) => setOtherHolder(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  className="mt-1.5 block w-full rounded-lg border-2 bg-transparent px-3 py-1.5 font-mono text-[12px] on-card outline-none"
                  style={{ borderColor: "rgb(22 22 26 / 0.15)" }}
                />
              )}
            </span>
          </label>
        </div>
        <div className="mt-4"><Btn onClick={claim} label="Sign and claim" /></div>
        {note}
      </section>
    );
  }

  if (!isPrincipal && !isIssuer) return null;

  return (
    <div className="space-y-5">
      {escalationCard}
      <section className="card-pop p-5" style={{ ["--pop" as string]: isIssuer ? "#7e65d4" : "#2f9e5e" }}>
        <p className="eyebrow">{isIssuer && isPrincipal ? "you issued this, and it is for you" : isIssuer ? "you issued this" : "this is for you"}</p>
        <h3 className="mt-1 text-lg font-semibold on-card">Your controls</h3>

        {isPrincipal && (
          <div className="mt-3">
            <p className="text-[13px] on-card-dim">
              As the recipient you can pause it or hand it back. Both are signatures — free, no MON needed.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {p.pausedByPrincipal
                ? <Btn onClick={() => principalAction(0, false, "Resume")} label="Resume" />
                : <Btn onClick={() => principalAction(0, true, "Pause")} label="Pause" tone="line" />}
              <Btn onClick={() => principalAction(1, true, "Hand it back")} label="Hand it back" tone="bad" />
            </div>
          </div>
        )}

        {isIssuer && (
          <div className="mt-4">
            <p className="text-[13px] on-card-dim">
              As the issuer you can pause it, end it, or end it and take the remaining money back in one
              transaction.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {p.pausedByIssuer
                ? <Btn onClick={() => issuerTx("setPausedByIssuer", [BigInt(p.capsuleId), false], "Resume")} label="Resume" />
                : <Btn onClick={() => issuerTx("setPausedByIssuer", [BigInt(p.capsuleId), true], "Pause")} label="Pause" tone="line" />}
              <Btn onClick={() => issuerTx("revoke", [BigInt(p.capsuleId)], "Revoke")} label="Revoke" tone="bad" />
              <Btn onClick={() => issuerTx("revokeVaultAndSweep", [BigInt(p.vaultId)], "Revoke and return the money")} label="Revoke and return the money" tone="bad" />
            </div>
          </div>
        )}
        {note}
      </section>
    </div>
  );
}
