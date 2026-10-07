import Link from "next/link";
import { Header } from "./components/Header";
import { Slabs } from "./components/Slabs";
import { SmoothScroll } from "./components/SmoothScroll";
import { Beat } from "./components/Beat";
import { readCapsule, preflight, type AssertName } from "../lib/chain/reads";
import { addresses } from "../lib/config/chain";

export const dynamic = "force-dynamic";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

/** Both beats, read live off the chain. Returns null if nothing is deployed. */
async function readBeats() {
  try {
    const capsule = await readCapsule(1n);
    if (capsule.holder === ZERO) return null;

    const quoted = 10n ** 18n;
    const minOut = (quoted * BigInt(10_000 - capsule.bounds.maxSlippageBps)) / 10_000n;
    const recipient =
      capsule.mode === 1 ? capsule.principal : capsule.mode === 2 ? capsule.fixedBeneficiary : (addresses.valet as `0x${string}`);

    const ask = (amountIn: bigint) =>
      preflight(
        { capsuleId: 1n, vaultId: capsule.vaultId, amountIn, quotedOut: quoted, minOut, target: addresses.kuruMarket, recipient },
        capsule.holder,
      );

    const within = capsule.bounds.perAction;
    const over = capsule.bounds.perAction * 4n;
    const [a, b] = await Promise.all([ask(within), ask(over)]);
    return { within, over, verdictWithin: a, verdictOver: b, cap: capsule.bounds.perAction };
  } catch {
    return null;
  }
}

export default async function Home() {
  const beats = await readBeats();

  return (
    <>
      <SmoothScroll />
      <Header />

      {/* --- the fold ---------------------------------------------------- */}
      <section className="relative isolate overflow-hidden">
        <div className="bloom absolute inset-0 -z-20" />
        <div className="grid-field absolute inset-0 -z-10 opacity-70" />
        <Slabs />

        <div className="relative mx-auto flex min-h-[86vh] max-w-6xl flex-col items-center justify-center px-6 text-center">
          <p className="eyebrow">bounded · revocable · enforced on monad</p>

          <h1 className="sheen relative mt-5 overflow-hidden font-mono text-[clamp(3rem,13vw,9rem)] font-bold leading-[0.84] tracking-[-0.04em]">
            VALET
          </h1>

          <p className="mt-6 max-w-2xl text-balance text-lg leading-snug text-text-dim sm:text-xl">
            A valet key for money. The car starts, the boot stays shut — and it isn&apos;t a promise,
            it&apos;s the shape of the key.
          </p>

          <p className="mt-4 max-w-xl text-balance text-sm leading-relaxed text-text-dim">
            Write what an agent may do in plain English. Send a link. The limits aren&apos;t in our
            code — they&apos;re nineteen checks on chain, on every single spend.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/c/1"
              className="rounded-full bg-text px-5 py-2.5 text-sm font-medium text-ink transition hover:opacity-90"
            >
              Open a live capsule
            </Link>
            <a
              href="https://github.com/technicalclipper/Valet"
              className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-text-dim transition hover:border-white/30 hover:text-text"
            >
              Read the contract
            </a>
          </div>

          <div className="nudge mt-14 font-mono text-[10px] uppercase tracking-[0.2em] text-text-faint">
            scroll ↓
          </div>
        </div>
      </section>

      {/* --- the two beats ----------------------------------------------- */}
      <section className="relative border-t border-white/[0.06]">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow">the whole product, in two transactions</p>
          <h2 className="mt-2 max-w-2xl text-2xl font-medium tracking-tight sm:text-3xl">
            Anyone can build an agent that spends money.
            <br />
            <span className="text-text-dim">We built the part that says no.</span>
          </h2>

          {beats ? (
            <>
              <div className="mt-8 grid gap-5 lg:grid-cols-2">
                <Beat amount={beats.within} verdict={beats.verdictWithin} cap={beats.cap} />
                <Beat amount={beats.over} verdict={beats.verdictOver} cap={beats.cap} />
              </div>
              <p className="mt-4 font-mono text-[11px] text-text-faint">
                Both verdicts are live: each is a preflight() call against the deployed capsule, and
                preflight shares its body with the charge — so these lights cannot promise anything
                the chain would refuse.
              </p>
            </>
          ) : (
            <p className="mt-8 rounded-lg border border-white/[0.07] bg-ink-2/60 p-5 text-[13px] text-text-dim">
              No capsule is deployed at this endpoint yet. Run{" "}
              <code className="font-mono text-text">./dev-setup.sh</code> to put a live one in front
              of this page.
            </p>
          )}
        </div>
      </section>

      {/* --- what it is for ---------------------------------------------- */}
      <section className="relative border-t border-white/[0.06] bg-ink-2/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <p className="eyebrow">what it&apos;s for</p>
          <div className="mt-6 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Set it up for Mum", "She gets a link, not a wallet. Google sign-in, an agent manages her savings, and she can hand it back any time. She never sees a seed phrase and never pays gas."],
              ["A strategy you don't babysit", "Thirty days, a daily budget, one venue. It trades while you sleep, inside limits you set once, while awake."],
              ["Any agent platform", "claim() takes an arbitrary address, so the holder can be an agent we never wrote. Every guarantee holds unchanged."],
              ["Allowances and payroll", "Anywhere one party funds and another spends — with a ceiling, a clock, and a revoke button."],
            ].map(([title, body]) => (
              <div key={title}>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-text-faint">{body}</p>
              </div>
            ))}
          </div>

          <p className="mt-12 max-w-2xl text-[13px] leading-relaxed text-text-dim">
            The primitive is delegated, bounded, revocable authority. Trading is just the demo.
          </p>
        </div>
      </section>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 font-mono text-[11px] text-text-faint">
          <span>Valet · Monad Metropolis</span>
          <span>Kuru for the venue · Privy for the keys · nineteen asserts for everything else</span>
        </div>
      </footer>
    </>
  );
}
