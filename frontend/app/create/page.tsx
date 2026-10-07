"use client";

import { useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address, EIP1193Provider } from "viem";
import { Header } from "../components/Header";
import { Verdicts } from "../components/Verdicts";
import { Identity } from "../components/Identity";
import { compile } from "../../lib/policy/compile";
import { extractWithRules } from "../../lib/policy/extract";
import { withHash } from "../../lib/policy/canonical";
import { devFund, mintCapsule, nativeBalance, usdcBalance, type MintProgress } from "../../lib/chain/writes";
import { amount } from "../../lib/format";
import { chain } from "../../lib/config/chain";
import type { CompileResult } from "../../lib/policy/types";

const EXAMPLES = [
  "Buy 5 USDC of MON daily for 30 days, max 1% slippage, send the MON to bob",
  "Buy 10 USDC of MON weekly for 12 weeks, hard cap 15 USDC, keep the vault",
  "Buy 2 USDC of MON every 2 days for 10 days, 0.5% slippage, and buy on dips",
  "Buy 5 USDC of MON daily for 30 days with 3x leverage",
];

export default function CreatePage() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];

  const [sentence, setSentence] = useState(EXAMPLES[0]);
  const [result, setResult] = useState<CompileResult | null>(null);
  const [balances, setBalances] = useState<{ usdc: bigint; mon: bigint } | null>(null);
  const [progress, setProgress] = useState<MintProgress | null>(null);
  const [minted, setMinted] = useState<{ capsuleId: bigint; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Compile as they type. The split is the product, so it should appear while
  // the sentence is still being written rather than after a submit.
  useEffect(() => {
    let live = true;
    (async () => {
      const extracted = await extractWithRules(sentence);
      const r = compile(sentence, extracted, Math.floor(Date.now() / 1000));
      if (live) setResult(r);
    })();
    return () => {
      live = false;
    };
  }, [sentence]);

  const address = wallet?.address as Address | undefined;

  const refresh = useMemo(
    () => async () => {
      if (!address) return;
      const [usdc, mon] = await Promise.all([usdcBalance(address), nativeBalance(address)]);
      setBalances({ usdc, mon });
    },
    [address],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onMint() {
    if (!wallet || !result?.ok || !result.policy) return;
    setError(null);
    try {
      const provider = (await wallet.getEthereumProvider()) as EIP1193Provider;
      const policy = withHash(result.policy);
      const { capsuleId } = await mintCapsule(provider, wallet.address as Address, policy, setProgress);
      const s = btoa(unescape(encodeURIComponent(sentence)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      setMinted({ capsuleId, link: `${location.origin}/c/${capsuleId}?s=${s}` });
      void refresh();
    } catch (e) {
      setError((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message);
    }
  }

  const needsFunds =
    balances !== null && result?.ok && result.policy
      ? balances.usdc < BigInt(result.policy.bounds.totalCap) || balances.mon === 0n
      : false;

  return (
    <>
      <Header />
      <main className="min-h-screen">
        <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
          <div className="grid-field absolute inset-0 -z-10 opacity-40" />
          <div className="mx-auto max-w-5xl px-6 py-10">
            <p className="eyebrow">new capsule</p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">
              Say what the agent may do.
            </h1>
            <p className="mt-2 max-w-2xl text-[15px] text-text-dim">
              In English. Every clause is sorted into what the chain will enforce, what the agent is
              merely told, and what we refuse — and you see all three before anything is minted.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
          {authenticated && address && (
            <Identity
              email={user?.google?.email ?? user?.email?.address}
              address={address}
              usdc={balances?.usdc}
              mon={balances?.mon}
              onDisconnect={logout}
            />
          )}

          {/* --- the sentence ------------------------------------------- */}
          <section>
            <label htmlFor="sentence" className="eyebrow">
              the permission, in your own words
            </label>
            <textarea
              id="sentence"
              rows={3}
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              className="mt-2 w-full resize-none rounded-lg border border-white/[0.12] bg-ink-2 px-4 py-3 text-[15px] leading-relaxed text-text outline-none focus:border-white/30"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMPLES.map((e, i) => (
                <button
                  key={i}
                  onClick={() => setSentence(e)}
                  className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-text-faint transition hover:border-white/25 hover:text-text"
                >
                  {i === EXAMPLES.length - 1 ? "one we refuse" : `example ${i + 1}`}
                </button>
              ))}
            </div>
          </section>

          {/* --- the three verdicts, live ------------------------------- */}
          {result && (
            <section>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="eyebrow">what the chain will keep</p>
                <p className="font-mono text-[11px] text-text-faint">
                  compiled locally · no model, no network
                </p>
              </div>
              <div className="mt-3">
                <Verdicts clauses={result.clauses} />
              </div>
              {!result.ok && (
                <div
                  className="mt-4 rounded-lg border p-4"
                  style={{ borderColor: "rgb(253 121 174 / 0.4)", background: "rgb(253 121 174 / 0.05)" }}
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: "var(--refused)" }}>
                    nothing will be minted
                  </p>
                  <ul className="mt-2 space-y-1 text-[13px] text-text-dim">
                    {result.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* --- mint -------------------------------------------------- */}
          <section className="card-pop p-5" style={{ ["--pop" as string]: "#7e65d4" }}>
            {!ready ? (
              <p className="text-[13px] on-card-faint">loading…</p>
            ) : !authenticated ? (
              <div>
                <h2 className="text-base font-semibold on-card">Sign in to mint it</h2>
                <p className="mt-1 text-[13px] on-card-dim">
                  Google or email. You get an embedded wallet whose key cannot be exported — which is
                  the point: the key you approve escalations with is one the agent can never hold.
                </p>
                <button
                  onClick={login}
                  className="mt-3 rounded-full px-4 py-2 text-sm font-medium text-white"
                  style={{ background: "#16161a" }}
                >
                  Sign in
                </button>
              </div>
            ) : (
              <div>
                <h2 className="text-base font-semibold on-card">Mint</h2>

                {result?.ok && result.policy && (
                  <p className="mt-2 text-[13px] on-card-dim">
                    Four transactions: open a vault, allow {amount(BigInt(result.policy.bounds.totalCap))} to
                    be moved, fund it, mint the permission. The approval is exact — nothing more can
                    be taken than the lifetime cap you just set.
                  </p>
                )}

                {needsFunds && !chain.isMainnet && (
                  <button
                    onClick={async () => {
                      if (address) {
                        await devFund(address);
                        await refresh();
                      }
                    }}
                    className="mt-3 mr-2 rounded-full border-2 px-4 py-2 text-sm font-medium on-card"
                    style={{ borderColor: "#16161a" }}
                  >
                    Fund this wallet (local fork only)
                  </button>
                )}

                <button
                  onClick={onMint}
                  disabled={!result?.ok || needsFunds || progress?.step === "mint"}
                  className="mt-3 rounded-full px-4 py-2 text-sm font-medium text-white disabled:opacity-35"
                  style={{ background: "#16161a" }}
                >
                  {progress && progress.step !== "done" ? progress.note : "Mint the capsule"}
                </button>

                {needsFunds && (
                  <p className="mt-2 text-[12px]" style={{ color: "#d8366f" }}>
                    This wallet needs {result?.policy ? amount(BigInt(result.policy.bounds.totalCap)) : "USDC"} and
                    some MON for gas.
                  </p>
                )}
                {error && (
                  <p className="mt-2 break-words text-[12px]" style={{ color: "#d8366f" }}>
                    {error}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* --- the link ---------------------------------------------- */}
          {minted && (
            <section className="card-pop p-5" style={{ ["--pop" as string]: "#2f9e5e" }}>
              <h2 className="text-base font-semibold on-card">Capsule #{minted.capsuleId.toString()} is live</h2>
              <p className="mt-1 text-[13px] on-card-dim">
                Send this link. It carries the sentence, so whoever opens it rebuilds the document and
                checks it against the chain themselves — nothing is taken on our word.
              </p>
              <a
                href={minted.link}
                className="mt-3 block break-all rounded-lg border-2 px-3 py-2 font-mono text-[12px] on-card"
                style={{ borderColor: "#16161a", background: "#f4f2ff" }}
              >
                {minted.link}
              </a>
            </section>
          )}
        </div>
      </main>
    </>
  );
}
