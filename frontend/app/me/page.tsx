"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAddress } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { Header } from "../components/Header";
import { useControls } from "../components/useControls";
import { findMine, type MyCapsule, type Status } from "../../lib/chain/mine";
import { linkFor, readLinks, type KnownLink } from "../../lib/links";
import { amount, cadence } from "../../lib/format";

const GROUPS: { status: Status; title: string; blurb: string; pop: string }[] = [
  { status: "running", title: "Running", blurb: "An agent is acting inside the limits right now.", pop: "#2f9e5e" },
  { status: "waiting", title: "Waiting to be claimed", blurb: "Nothing can be spent until the recipient picks who acts.", pop: "#7e65d4" },
  { status: "paused", title: "Paused", blurb: "On hold. No spend goes through until it is resumed.", pop: "#c2b5ff" },
  { status: "ended", title: "Ended", blurb: "Revoked, handed back, expired or spent. Nothing more can move.", pop: "#9a9aad" },
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Everything you have sent and everything sent to you, read from the chain.
 *
 * Two tabs because the two roles hold different powers over the same kind of
 * object: the issuer can pause, revoke, or revoke and take the money back; the
 * recipient can pause or hand it back. Each card offers exactly what your role
 * allows on that capsule and nothing it does not — a card cannot show a button
 * the contract would refuse.
 */
export default function MinePage() {
  const { ready, authenticated, login } = usePrivy();
  const [rows, setRows] = useState<MyCapsule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"sent" | "received">("sent");
  const [known, setKnown] = useState<Record<string, KnownLink>>({});
  const [origin, setOrigin] = useState("");

  const load = useCallback(async (me: `0x${string}`) => {
    setError(null);
    try {
      setRows(await findMine(me));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const controls = useControls();
  const me = controls.me;
  const [asAddress, setAsAddress] = useState<`0x${string}` | null>(null);

  useEffect(() => {
    setKnown(readLinks());
    setOrigin(location.origin);
    // ?address=0x… shows any wallet's capsules, read-only. All of it is public on
    // chain anyway; this just saves someone reading the events by hand.
    const a = new URLSearchParams(location.search).get("address");
    if (a && /^0x[0-9a-fA-F]{40}$/.test(a)) setAsAddress(getAddress(a.toLowerCase()));
  }, []);

  const viewing = asAddress ?? me;
  const readOnly = !me || (!!asAddress && asAddress.toLowerCase() !== me.toLowerCase());

  useEffect(() => {
    if (viewing) void load(viewing);
  }, [viewing, load]);

  const refresh = useCallback(() => {
    if (viewing) void load(viewing);
  }, [viewing, load]);

  const sent = useMemo(() => rows?.filter((r) => r.asIssuer) ?? [], [rows]);
  const received = useMemo(() => rows?.filter((r) => r.asRecipient) ?? [], [rows]);
  const list = tab === "sent" ? sent : received;

  // first time a person lands here with nothing sent but something received, show what they have
  useEffect(() => {
    if (rows && sent.length === 0 && received.length > 0) setTab("received");
  }, [rows, sent.length, received.length]);

  return (
    <>
      <Header />
      <main className="min-h-screen">
        <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
          <div className="grid-field absolute inset-0 -z-10 opacity-40" />
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
            <p className="eyebrow">your capsules</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">Everything you&apos;ve sent, and everything sent to you.</h1>
            <p className="mt-2 max-w-2xl text-[15px] text-text-dim">
              Read from the chain&apos;s own events, not a list we keep — a server could forget one, the chain
              cannot. End any of them here.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
          {asAddress && readOnly && (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[12px] text-text-dim">
              Viewing {short(asAddress)} read-only. Controls appear only for the wallet you are signed in as.
            </p>
          )}
          {!ready ? null : !authenticated && !asAddress ? (
            <section className="card-pop p-6" style={{ ["--pop" as string]: "#7e65d4" }}>
              <h2 className="text-lg font-semibold on-card">Sign in to see your capsules</h2>
              <p className="mt-1 text-[13px] on-card-dim">
                The ones you issued and the ones issued to you are found from your wallet&apos;s address. If a capsule
                was sent to your email, sign in with that email.
              </p>
              <button onClick={login} className="mt-3 rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: "#16161a" }}>
                Sign in
              </button>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ["sent", `Sent by you`, sent.length],
                  ["received", `For you`, received.length],
                ] as const).map(([key, label, n]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className="rounded-full border-2 px-4 py-1.5 text-sm font-semibold transition"
                    style={
                      tab === key
                        ? { background: "#fdfcff", borderColor: "#fdfcff", color: "#16161a" }
                        : { borderColor: "rgb(255 255 255 / 0.18)", color: "var(--text-dim)" }
                    }
                  >
                    {label} <span className="ml-1 font-mono text-[12px] opacity-70">{rows ? n : "…"}</span>
                  </button>
                ))}
                <button onClick={refresh} className="ml-auto font-mono text-[11px] text-text-faint underline decoration-dotted hover:text-text">
                  refresh
                </button>
              </div>

              {error && (
                <p className="rounded-lg border p-3 text-[13px]" style={{ borderColor: "rgb(253 121 174 / 0.4)", color: "var(--refused)" }}>
                  Couldn&apos;t read the chain: {error}
                </p>
              )}

              {rows === null && !error && <p className="font-mono text-[12px] text-text-faint">reading the chain…</p>}

              {rows && list.length === 0 && (
                <section className="card-pop p-6" style={{ ["--pop" as string]: "#7e65d4" }}>
                  <h2 className="text-lg font-semibold on-card">
                    {tab === "sent" ? "You haven't issued a capsule yet" : "Nothing has been sent to you yet"}
                  </h2>
                  <p className="mt-1 text-[13px] on-card-dim">
                    {tab === "sent"
                      ? "Write a permission in plain English and send someone the link."
                      : `Capsules naming ${viewing ? short(viewing) : "your wallet"} as the recipient will appear here.`}
                  </p>
                  {tab === "sent" && (
                    <Link href="/create" className="mt-3 inline-block rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: "#16161a" }}>
                      Write a permission
                    </Link>
                  )}
                </section>
              )}

              {rows &&
                GROUPS.map((g) => {
                  const items = list.filter((r) => r.status === g.status);
                  if (!items.length) return null;
                  return (
                    <section key={g.status}>
                      <div className="mb-3 flex items-baseline gap-3">
                        <h2 className="text-sm font-semibold" style={{ color: g.status === "ended" ? "var(--text-faint)" : g.pop }}>
                          {g.title} <span className="ml-1 font-mono text-[12px] opacity-70">{items.length}</span>
                        </h2>
                        <p className="text-[12px] text-text-faint">{g.blurb}</p>
                      </div>
                      <div className="grid gap-5 lg:grid-cols-2">
                        {items.map((r) => (
                          <CapsuleCard key={r.id} r={r} role={tab} pop={g.pop} known={known[r.id]} origin={origin} controls={controls} onChanged={refresh} readOnly={readOnly} />
                        ))}
                      </div>
                    </section>
                  );
                })}
            </>
          )}
        </div>
      </main>
    </>
  );
}

function CapsuleCard({
  r, role, pop, known, origin, controls, onChanged, readOnly,
}: {
  r: MyCapsule;
  role: "sent" | "received";
  pop: string;
  known?: KnownLink;
  origin: string;
  controls: ReturnType<typeof useControls>;
  onChanged: () => void;
  readOnly: boolean;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const c = r.capsule;
  const b = c.bounds;
  const ended = r.status === "ended";
  const pct = b.totalCap > 0n ? Number((c.spentTotal * 10_000n) / b.totalCap) / 100 : 0;
  const day = Math.min(Number(r.windowIndex) + 1, b.windows);
  const counterparty = role === "sent" ? c.principal : c.issuer;
  const href = known ? linkFor(r.id, origin, known) : `/c/${r.id}`;
  const busy = controls.busy;
  const msg = controls.msg && controls.msg.key.startsWith(`${r.id}:`) ? controls.msg : null;

  /** irreversible actions take two clicks */
  function twice(key: string, act: () => Promise<unknown>) {
    if (confirming !== key) return setConfirming(key);
    setConfirming(null);
    void act().then(onChanged);
  }

  const Btn = ({ k, label, tone = "line", onClick }: { k: string; label: string; tone?: "dark" | "line" | "bad"; onClick: () => void }) => (
    <button
      onClick={onClick}
      disabled={!!busy}
      className="rounded-full border-2 px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40"
      style={
        tone === "dark" ? { background: "#16161a", borderColor: "#16161a", color: "#fdfcff" }
          : tone === "bad" ? { borderColor: "#d8366f", color: confirming === k ? "#fdfcff" : "#b5245a", background: confirming === k ? "#d8366f" : "transparent" }
            : { borderColor: "rgb(22 22 26 / 0.2)", color: "#16161a" }
      }
    >
      {busy === k ? "…" : confirming === k ? `Confirm: ${label.toLowerCase()}?` : label}
    </button>
  );

  return (
    <article className="card-pop card-enter flex flex-col p-5" style={{ ["--pop" as string]: pop, opacity: ended ? 0.72 : 1 }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: ended ? "#7b7b8d" : pop === "#c2b5ff" ? "#5b45a8" : pop }}>
          {r.status === "waiting" ? "waiting" : r.status} · #{r.id}
        </span>
        <span className="font-mono text-[11px] on-card-faint">
          {role === "sent" ? "for" : "from"} {short(counterparty)}
          {role === "sent" && known?.email ? ` · ${known.email}` : ""}
        </span>
      </div>

      <h3 className="mt-2 text-lg font-semibold leading-snug on-card">
        {amount(b.perAction)} of MON, {cadence(b.windowLength)} for {b.windows} {Number(b.windowLength) === 86400 ? "days" : "periods"}
      </h3>
      {known?.sentence && <p className="mt-1 text-[13px] italic on-card-dim">&ldquo;{known.sentence}&rdquo;</p>}

      <div className="mt-4">
        <div className="flex items-baseline justify-between font-mono text-[11px]">
          <span className="on-card-faint">{ended ? "finished" : `day ${day} of ${b.windows}`}</span>
          <span className="on-card">{amount(c.spentTotal)} <span className="on-card-faint">of {amount(b.totalCap)}</span></span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border-2" style={{ borderColor: "#16161a" }}>
          <div className="fill-bar h-full" style={{ ["--fill" as string]: `${pct}%`, width: `${pct}%`, background: ended ? "#9a9aad" : pop }} />
        </div>
        {role === "sent" && !r.vaultRevoked && (
          <p className="mt-1.5 font-mono text-[11px] on-card-faint">vault holds {amount(r.vaultBalance)}</p>
        )}
        {ended && r.endedBecause && <p className="mt-1.5 text-[12px] on-card-faint">Ended: {r.endedBecause}.</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={href} className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "#16161a" }}>
          Open
        </Link>

        {!ended && !readOnly && role === "sent" && (
          <>
            {c.pausedByIssuer
              ? <Btn k={`${r.id}:resume`} label="Resume" onClick={() => void controls.issuerTx("setPausedByIssuer", [BigInt(r.id), false], `${r.id}:resume`).then(onChanged)} />
              : <Btn k={`${r.id}:pause`} label="Pause" onClick={() => void controls.issuerTx("setPausedByIssuer", [BigInt(r.id), true], `${r.id}:pause`).then(onChanged)} />}
            <Btn k={`${r.id}:revoke`} label="Revoke" tone="bad" onClick={() => twice(`${r.id}:revoke`, () => controls.issuerTx("revoke", [BigInt(r.id)], `${r.id}:revoke`, "Revoked. Nothing more can be spent."))} />
            <Btn k={`${r.id}:sweep`} label="Revoke and return the money" tone="bad" onClick={() => twice(`${r.id}:sweep`, () => controls.issuerTx("revokeVaultAndSweep", [c.vaultId], `${r.id}:sweep`, "Revoked, and the vault's remaining USDC is back with you."))} />
          </>
        )}

        {!ended && !readOnly && role === "received" && (
          <>
            {c.pausedByPrincipal
              ? <Btn k={`${r.id}:resume`} label="Resume" onClick={() => void controls.principalAction(r.id, 0, false, `${r.id}:resume`).then(onChanged)} />
              : <Btn k={`${r.id}:pause`} label="Pause" onClick={() => void controls.principalAction(r.id, 0, true, `${r.id}:pause`).then(onChanged)} />}
            <Btn k={`${r.id}:handback`} label="Hand it back" tone="bad" onClick={() => twice(`${r.id}:handback`, () => controls.principalAction(r.id, 1, true, `${r.id}:handback`, "Handed back. It's ended, and it cost you nothing."))} />
          </>
        )}
      </div>

      {role === "sent" && !ended && !readOnly && (
        <p className="mt-2 text-[11px] on-card-faint">
          Revoke ends this capsule. Revoke-and-return also closes its vault — and every other capsule drawing on it.
        </p>
      )}
      {role === "received" && !ended && !readOnly && (
        <p className="mt-2 text-[11px] on-card-faint">Pausing and handing back are signatures — free, no MON needed.</p>
      )}
      {msg && <p className="mt-2 text-[12px]" style={{ color: msg.tone === "good" ? "#1f7a46" : "#b5245a" }}>{msg.text}</p>}
    </article>
  );
}
