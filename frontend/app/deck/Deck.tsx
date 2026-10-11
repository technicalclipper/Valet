"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ASSERT_GROUPS } from "../../lib/chain/reads";

/**
 * The pitch, in ten slides, in the product's own clothes.
 *
 * Each slide is a few words and one picture. The pictures are the product's
 * own: the money flow from the console, the nineteen lights, the sticker cards.
 * Only the active slide is mounted, so every visit replays its arrival.
 *
 * ← → / space / swipe to move, F for fullscreen, and the slide number lives in
 * the URL hash so a link can open on any slide.
 */

const VALET = "0x8e77216e07cE1E4F9b5Db47621a1ef266b0d85C2";
const KURU = "https://www.kuru.io/markets/0x065c9d28e428a0db40191a54d33d5b7c71a9c394/trade";
const FIRST_TRADE = "0x1b92017bd33e3c9c96a126a54877b5b51bc40132582f4ad137e35bea093e6bf6";
const APPROVED_TRADE = "0x29d498ed2b18c64ce1ef10a0e2f555e7498c07ecee04bc1920467150815ed919";
const tx = (h: string) => `https://monadvision.com/tx/${h}`;
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

const POP = { lav: "#7e65d4", green: "#2f9e5e", pink: "#d8366f", peri: "#a493f0" } as const;

// --- pieces -----------------------------------------------------------------

const d = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

function Eyebrow({ children, at = 0 }: { children: ReactNode; at?: number }) {
  return <p className="eyebrow deck-in" style={d(at)}>{children}</p>;
}

function Title({ children, at = 80, size = "lg" }: { children: ReactNode; at?: number; size?: "lg" | "xl" }) {
  return (
    <h2
      className={`deck-in mt-3 text-balance font-semibold tracking-[-0.03em] ${size === "xl" ? "text-[clamp(2.2rem,6vw,4.6rem)] leading-[0.95]" : "text-[clamp(1.8rem,4.4vw,3.4rem)] leading-[1.02]"}`}
      style={d(at)}
    >
      {children}
    </h2>
  );
}

function Sticker({
  pop = POP.lav, at = 0, tilt = 0, className = "", children,
}: { pop?: string; at?: number; tilt?: number; className?: string; children: ReactNode }) {
  return (
    <div
      className={`card-pop deck-drop p-5 ${className}`}
      style={{ ["--pop" as string]: pop, ["--tilt" as string]: `${tilt}deg`, ...d(at) }}
    >
      {children}
    </div>
  );
}

function Chip({ children, tone = "dim" }: { children: ReactNode; tone?: "dim" | "good" | "bad" | "peri" }) {
  const c = tone === "good" ? "var(--enforced)" : tone === "bad" ? "var(--refused)" : tone === "peri" ? "var(--peri)" : "var(--text-dim)";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-[11px]" style={{ borderColor: `color-mix(in srgb, ${c} 45%, transparent)`, color: c }}>
      {children}
    </span>
  );
}

const Out = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-4 hover:opacity-80">
    {children}
  </a>
);

// --- the slides -------------------------------------------------------------

function Cover() {
  return (
    <div className="flex flex-col items-center text-center">
      <Eyebrow>monad metropolis · track 04 · trust, identity &amp; ai</Eyebrow>
      <h1 className="sheen deck-in relative mt-6 overflow-hidden font-mono text-[clamp(4rem,16vw,11rem)] font-bold leading-[0.82] tracking-[-0.05em]" style={d(120)}>
        VALET
      </h1>
      <p className="deck-in mt-7 max-w-2xl text-balance text-[clamp(1.15rem,2.4vw,1.7rem)] leading-snug" style={d(320)}>
        Trust an agent with money —<br />
        <span className="text-text-dim">without handing it your keys.</span>
      </p>
      <p className="deck-in mt-5 max-w-xl text-balance font-mono text-[clamp(0.8rem,1.4vw,0.95rem)] leading-relaxed text-peri" style={d(440)}>
        shareable links that let an AI agent act on your behalf — within the limits you set.
      </p>
      <div className="deck-in mt-8 flex flex-wrap justify-center gap-2" style={d(600)}>
        <Chip tone="good"><span className="pulse-live h-1.5 w-1.5 rounded-full bg-enforced" /> live on monad mainnet</Chip>
        <Chip tone="peri">trades on Kuru</Chip>
        <Chip tone="peri">keys by Privy</Chip>
      </div>
    </div>
  );
}

function Problem() {
  const cards: [string, string, string, number][] = [
    ["Hand it your key", "Full access. One bad prompt and it's all gone.", POP.pink, -1.5],
    ["Approve every move", "Safe — but then it isn't an agent.", POP.lav, 1],
    ["Trust the app", "A limit in someone's server is a promise, not a guarantee.", POP.peri, -0.5],
  ];
  return (
    <div>
      <Eyebrow>the problem</Eyebrow>
      <Title>Agents can trade.<br /><span className="text-text-dim">Nobody trusts them with a wallet.</span></Title>
      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        {cards.map(([t, b, pop, tilt], i) => (
          <Sticker key={t} pop={pop} tilt={tilt} at={300 + i * 140}>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: pop }}>option {i + 1}</div>
            <h3 className="mt-2 text-xl font-semibold on-card">{t}</h3>
            <p className="mt-1.5 text-[14px] leading-snug on-card-dim">{b}</p>
          </Sticker>
        ))}
      </div>
      <p className="deck-in mt-10 font-mono text-[13px] text-text-faint" style={d(820)}>
        today it&apos;s all or nothing.
      </p>
    </div>
  );
}

function Solution() {
  const terms: [string, string][] = [
    ["0.1 USDC", "per trade"],
    ["once a day", "for 5 days"],
    ["0.2 USDC", "hard cap — nothing lifts it"],
    ["1%", "max slippage"],
    ["Kuru", "the only venue"],
    ["→ Mom", "proceeds, same transaction"],
  ];
  return (
    <div>
      <Eyebrow>what we built</Eyebrow>
      <Title>A spending limit,<br /><span className="text-text-dim">not your wallet.</span></Title>
      <div className="mt-9 grid items-center gap-6 lg:grid-cols-[1fr_auto_1.2fr]">
        <Sticker pop={POP.peri} at={250} tilt={-1}>
          <div className="eyebrow">you write</div>
          <p className="mt-2 text-[17px] font-medium leading-snug on-card">
            “Buy 0.1 USDC of MON daily for 5 days, never more than 0.2 in one trade, 1% max slippage, for Mom.”
          </p>
        </Sticker>
        <div className="deck-in text-center font-mono text-3xl text-peri" style={d(450)}>→</div>
        <Sticker pop={POP.green} at={560} tilt={0.8}>
          <div className="flex items-baseline justify-between">
            <div className="eyebrow">the chain enforces</div>
            <span className="font-mono text-[11px]" style={{ color: POP.green }}>capsule #1</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
            {terms.map(([k, v], i) => (
              <div key={k} className="deck-in" style={d(700 + i * 70)}>
                <div className="text-[15px] font-semibold on-card">✓ {k}</div>
                <div className="text-[12px] leading-tight on-card-faint">{v}</div>
              </div>
            ))}
          </div>
        </Sticker>
      </div>
      <div className="deck-in mt-9 flex flex-wrap gap-2" style={d(1200)}>
        <Chip tone="good">bounded</Chip>
        <Chip tone="good">revocable by either side</Chip>
        <Chip tone="good">enforced on chain, not in our code</Chip>
      </div>
    </div>
  );
}

function Flow() {
  const steps: [string, string, string][] = [
    ["Write", "a sentence becomes a policy", POP.peri],
    ["Mint", "fund a vault, sign once", POP.lav],
    ["Share", "a link — even to an email", POP.lav],
    ["Claim", "recipient picks the agent, no gas", POP.green],
    ["Trade", "agent buys on Kuru, MON lands", POP.green],
  ];
  return (
    <div>
      <Eyebrow>how it works</Eyebrow>
      <Title>Five steps.<br /><span className="text-text-dim">Your keys never leave you.</span></Title>
      <div className="relative mt-12">
        <div className="deck-rail absolute left-[10%] right-[10%] top-7 hidden border-t-2 border-dashed border-white/15 sm:block" style={d(300)} />
        <ol className="relative grid gap-4 sm:grid-cols-5">
          {steps.map(([t, b, pop], i) => (
            <li key={t} className="flex flex-col items-center text-center">
              <div
                className="deck-drop grid h-14 w-14 place-items-center rounded-full border-2 border-[#16161a] bg-[#fdfcff] font-mono text-lg font-bold text-[#16161a]"
                style={{ boxShadow: `4px 4px 0 0 ${pop}`, ...d(350 + i * 160) }}
              >
                {i + 1}
              </div>
              <div className="deck-in mt-4 text-lg font-semibold" style={d(450 + i * 160)}>{t}</div>
              <div className="deck-in mt-1 max-w-[12rem] text-[13px] leading-snug text-text-dim" style={d(500 + i * 160)}>{b}</div>
            </li>
          ))}
        </ol>
      </div>
      <p className="deck-in mt-12 text-center font-mono text-[13px] text-text-faint" style={d(1300)}>
        the issuer or the recipient can pause or revoke — any time, in one click.
      </p>
    </div>
  );
}

function OneTransaction() {
  const nodes: [string, string, number][] = [
    ["vault", "issuer's USDC", 9],
    ["Kuru", "the order book", 37],
    ["Valet", "measures the fill", 64],
    ["recipient", "gets the MON", 91],
  ];
  return (
    <div>
      <Eyebrow>one trade = one transaction</Eyebrow>
      <Title>If Kuru pays less than the floor,<br /><span className="text-text-dim">nothing happened at all.</span></Title>

      <div className="deck-in relative mt-12 h-[132px] rounded-2xl border-2 border-[#16161a] bg-[#101014] sm:h-[146px]" style={d(300)}>
        <div className="grid-field pointer-events-none absolute inset-0 rounded-2xl opacity-40" />
        {/* the token rides its own rail, above the boxes, so it is never hidden behind one */}
        <div className="absolute left-[9%] right-[9%] top-[21px] border-t-2 border-dashed border-white/15" />
        <div className="deck-token absolute top-[15px] z-10 h-3.5 w-3.5 -translate-x-1/2 rounded-full" />
        {nodes.map(([n, s, x]) => (
          <div key={n} className="absolute top-[40px] flex -translate-x-1/2 flex-col items-center" style={{ left: `${x}%` }}>
            <div className="grid h-[56px] w-[88px] place-items-center rounded-lg border-2 border-white/15 bg-[#16161c] sm:w-[120px]">
              <span className="text-[13px] font-semibold sm:text-[15px]">{n}</span>
            </div>
            <span className="mt-1.5 hidden font-mono text-[10px] text-text-faint sm:block">{s}</span>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-4">
        {[
          ["1", "19 checks pass, caps charged"],
          ["2", "approve exactly the amount → Kuru buys, fill-or-kill"],
          ["3", "measure what arrived, require ≥ floor"],
          ["4", "pay the recipient — or revert everything"],
        ].map(([n, t], i) => (
          <div key={n} className="deck-in flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3" style={d(600 + i * 120)}>
            <span className="font-mono text-[12px] text-peri">{n}</span>
            <span className="text-[13px] leading-snug text-text-dim">{t}</span>
          </div>
        ))}
      </div>
      <p className="deck-in mt-6 font-mono text-[12px] text-text-faint" style={d(1150)}>
        the agent never holds the money — not for a single instruction.
      </p>
    </div>
  );
}

function KuruSlide() {
  return (
    <div>
      <Eyebrow>kuru integration</Eyebrow>
      <Title>A consumer trading app<br /><span className="text-text-dim">on Kuru&apos;s order book.</span></Title>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        <Sticker pop={POP.lav} at={250} tilt={-1}>
          <div className="eyebrow">real fills</div>
          <h3 className="mt-2 text-lg font-semibold on-card">placeAndExecuteMarketBuy</h3>
          <p className="mt-1 text-[13px] on-card-dim">Fill-or-kill on MON/USDC, market #00558. A partial fill is refused.</p>
        </Sticker>
        <Sticker pop={POP.peri} at={400} tilt={0.8}>
          <div className="eyebrow">the floor</div>
          <h3 className="mt-2 text-lg font-semibold on-card">from the live book</h3>
          <p className="mt-1 text-[13px] on-card-dim">bestBidAsk() → quote → floor within the capsule&apos;s slippage. Checked twice.</p>
        </Sticker>
        <Sticker pop={POP.pink} at={550} tilt={-0.6}>
          <div className="eyebrow">only kuru</div>
          <h3 className="mt-2 text-lg font-semibold on-card">one allowed target</h3>
          <p className="mt-1 text-[13px] on-card-dim">Anywhere else: <span className="font-mono">TARGET_NOT_ALLOWED</span>. The money can&apos;t be routed away.</p>
        </Sticker>
      </div>
      <div className="deck-in mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border px-4 py-3" style={{ borderColor: "rgb(178 255 166 / 0.3)", background: "rgb(178 255 166 / 0.05)", ...d(800) }}>
        <span className="font-mono text-[13px] text-enforced">✓ on mainnet: 0.1 USDC → 0.0396 MON, straight to the recipient</span>
        <span className="ml-auto flex gap-4 font-mono text-[12px] text-peri">
          <Out href={tx(FIRST_TRADE)}>tx {short(FIRST_TRADE)} ↗</Out>
          <Out href={KURU}>MON/USDC on Kuru ↗</Out>
        </span>
      </div>
    </div>
  );
}

function PrivySlide() {
  const items: [string, string, string][] = [
    ["Sign in with email or Google", "An embedded wallet appears. No extension, no seed phrase.", POP.lav],
    ["Send to an email", "We pregenerate their wallet. The claim is waiting when they log in.", POP.peri],
    ["Every recipient action is a signature", "Claim, pause, hand back — EIP-712, relayed. They never need gas.", POP.green],
    ["Approvals from keys agents can't hold", "Embedded keys don't export. Only the issuer can say yes.", POP.pink],
  ];
  return (
    <div>
      <Eyebrow>privy integration</Eyebrow>
      <Title>The agent never touches<br /><span className="text-text-dim">a key that matters.</span></Title>
      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {items.map(([t, b, pop], i) => (
          <Sticker key={t} pop={pop} at={250 + i * 130} tilt={i % 2 ? 0.6 : -0.8}>
            <h3 className="text-[17px] font-semibold on-card">{t}</h3>
            <p className="mt-1 text-[13px] leading-snug on-card-dim">{b}</p>
          </Sticker>
        ))}
      </div>
    </div>
  );
}

const FLAT = ASSERT_GROUPS.flatMap((g) => g.members);

function Checks() {
  return (
    <div>
      <Eyebrow>enforced on chain</Eyebrow>
      <Title>Nineteen named checks.<br /><span className="text-text-dim">On every single trade.</span></Title>
      <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="deck-in rounded-2xl border-2 border-[#16161a] bg-[#101014] p-5" style={d(250)}>
          <div className="flex flex-wrap gap-x-5 gap-y-4">
            {ASSERT_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="eyebrow mb-1.5">{g.label}</div>
                <div className="flex gap-1">
                  {g.members.map((m) => (
                    <span key={m} title={m} className="deck-light h-4 w-4 rounded-[4px]" style={d(450 + FLAT.indexOf(m) * 75)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="deck-in mt-5 font-mono text-[12px] text-enforced" style={d(450 + 19 * 75 + 100)}>
            all nineteen pass → the trade runs
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Sticker pop={POP.pink} at={600}>
            <div className="font-mono text-[12px]" style={{ color: POP.pink }}>Refused(OVER_ACTION_CAP)</div>
            <p className="mt-1 text-[14px] on-card">4× the cap? Refused by name. Nothing sent, nothing spent.</p>
          </Sticker>
          <Sticker pop={POP.lav} at={800}>
            <div className="font-mono text-[12px]" style={{ color: POP.lav }}>escalation</div>
            <p className="mt-1 text-[14px] on-card">The agent can <b>ask</b> for more. Only you can say yes — and nothing lifts the hard cap.</p>
          </Sticker>
        </div>
      </div>
    </div>
  );
}

function UseCases() {
  const cases: [string, string, string, string, number][] = [
    ["💌", "Send to Mom", "Fund a daily MON buy by email. She signs in with Google, never pays gas, and can hand it back.", POP.pink, -1.5],
    ["🤖", "Agent marketplace", "Hire a trading agent under your limits. Hand it a capsule, not a key. Any agent plugs in over MCP.", POP.lav, 1],
    ["🎟️", "Spending for anyone", "Allowances, payroll, a contractor's budget — a ceiling, a clock, and a revoke button.", POP.green, -0.6],
  ];
  return (
    <div>
      <Eyebrow>use cases</Eyebrow>
      <Title>Delegated money,<br /><span className="text-text-dim">for people and for agents.</span></Title>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {cases.map(([icon, t, b, pop, tilt], i) => (
          <Sticker key={t} pop={pop} tilt={tilt} at={280 + i * 160} className="p-6">
            <div className="text-4xl">{icon}</div>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight on-card">{t}</h3>
            <p className="mt-2 text-[14px] leading-snug on-card-dim">{b}</p>
          </Sticker>
        ))}
      </div>
    </div>
  );
}

function Live() {
  const stats: [string, string][] = [
    ["19", "checks on chain"],
    ["2", "real Kuru fills"],
    ["0", "gas for the recipient"],
    ["190", "tests passing"],
  ];
  return (
    <div className="flex flex-col items-center text-center">
      <Eyebrow>live on monad mainnet</Eyebrow>
      <Title size="xl">Give an agent a spending limit,<br /><span className="text-text-dim">not your wallet.</span></Title>
      <div className="mt-10 grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map(([n, l], i) => (
          <Sticker key={l} pop={[POP.green, POP.lav, POP.peri, POP.pink][i]} at={300 + i * 120} className="py-4 text-center">
            <div className="font-mono text-4xl font-bold on-card">{n}</div>
            <div className="mt-1 text-[12px] on-card-faint">{l}</div>
          </Sticker>
        ))}
      </div>
      <div className="deck-in mt-8 font-mono text-[12px] text-text-dim" style={d(850)}>
        Valet <Out href={`https://monadvision.com/address/${VALET}`}>{VALET}</Out>
      </div>
      <div className="deck-in mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 font-mono text-[12px] text-peri" style={d(950)}>
        <Out href={tx(FIRST_TRADE)}>first Kuru trade ↗</Out>
        <Out href={tx(APPROVED_TRADE)}>approved trade ↗</Out>
        <Out href={KURU}>Kuru MON/USDC ↗</Out>
        <Out href="https://github.com/technicalclipper/Valet">github ↗</Out>
      </div>
      <div className="deck-in mt-8 flex flex-wrap justify-center gap-3" style={d(1100)}>
        <Link href="/create" className="rounded-full bg-text px-5 py-2.5 text-sm font-medium text-ink transition hover:opacity-90">
          Write a permission
        </Link>
        <Link href="/c/1" className="rounded-full border border-white/15 px-5 py-2.5 text-sm text-text-dim transition hover:border-white/30 hover:text-text">
          Watch the agent
        </Link>
      </div>
    </div>
  );
}

const SLIDES: { name: string; render: () => ReactNode }[] = [
  { name: "valet", render: Cover },
  { name: "problem", render: Problem },
  { name: "what we built", render: Solution },
  { name: "how it works", render: Flow },
  { name: "one transaction", render: OneTransaction },
  { name: "kuru", render: KuruSlide },
  { name: "privy", render: PrivySlide },
  { name: "nineteen checks", render: Checks },
  { name: "use cases", render: UseCases },
  { name: "live", render: Live },
];

/**
 * The slabs, pushed to the edges. The landing page centres its text, so its
 * slabs can sit a fifth of the way in; slides are left-aligned and wide, so
 * here they only peek in from the sides, where nothing is written.
 */
const EDGE_SLABS: { side: "l" | "r"; top: number; w: number; h: number; grad: string; o: number; dur: number }[] = [
  { side: "l", top: 8, w: 9, h: 9, grad: "var(--slab-l)", o: 0.7, dur: 9 },
  { side: "l", top: 72, w: 11, h: 11, grad: "var(--slab-r)", o: 0.4, dur: 12 },
  { side: "r", top: 14, w: 10, h: 10, grad: "var(--slab-r)", o: 0.65, dur: 10 },
  { side: "r", top: 58, w: 8, h: 7, grad: "var(--slab-face)", o: 0.35, dur: 13 },
];
const CLIP = { l: "polygon(0% 22%, 100% 0%, 100% 78%, 0% 100%)", r: "polygon(0% 0%, 100% 22%, 100% 100%, 0% 78%)" };

function EdgeSlabs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-[5] overflow-hidden">
      {EDGE_SLABS.map((s, n) => (
        <div
          key={n}
          className="deck-float absolute"
          style={{
            [s.side === "l" ? "left" : "right"]: `-${s.w * 0.62}%`,
            top: `${s.top}%`, width: `${s.w}%`, height: `${s.h}%`,
            background: s.grad, opacity: s.o, clipPath: CLIP[s.side],
            animationDuration: `${s.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

// --- the deck ---------------------------------------------------------------

export function Deck() {
  const [i, setI] = useState(0);
  const touch = useRef<number | null>(null);
  const last = SLIDES.length - 1;

  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(last, n));
    setI(next);
    history.replaceState(null, "", `#${next + 1}`);
  }, [last]);

  // open on the slide in the hash, and follow it if someone edits it
  useEffect(() => {
    const read = () => {
      const n = Number(location.hash.slice(1));
      if (n >= 1 && n <= SLIDES.length) setI(n - 1);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)) { e.preventDefault(); go(i + 1); }
      else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)) { e.preventDefault(); go(i - 1); }
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(last);
      else if (e.key.toLowerCase() === "f") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go, last]);

  const Slide = SLIDES[i].render;

  return (
    <main
      className="relative isolate flex h-[100dvh] flex-col overflow-hidden"
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
        touch.current = null;
      }}
    >
      <div className="bloom absolute inset-0 -z-20" />
      <div className="grid-field absolute inset-0 -z-10 opacity-60" />
      <EdgeSlabs />

      {/* progress */}
      <div className="absolute inset-x-0 top-0 h-[3px] bg-white/[0.06]">
        <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${((i + 1) / SLIDES.length) * 100}%`, background: "linear-gradient(90deg, var(--lav-deep), var(--enforced))" }} />
      </div>

      <header className="flex items-center justify-between px-5 pt-5 sm:px-10 sm:pt-7">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-mono text-lg leading-none">⇥</span>
          <span className="text-sm font-medium tracking-tight">Valet</span>
        </Link>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-text-faint">
          {String(i + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")} · {SLIDES[i].name}
        </span>
      </header>

      <section className="flex flex-1 items-center overflow-y-auto">
        <div key={i} className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-10">
          <Slide />
        </div>
      </section>

      <footer className="flex items-center justify-between gap-4 px-5 pb-5 sm:px-10 sm:pb-7">
        <div className="flex gap-1.5">
          {SLIDES.map((s, n) => (
            <button
              key={s.name}
              aria-label={`slide ${n + 1}: ${s.name}`}
              onClick={() => go(n)}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{ width: n === i ? 22 : 6, background: n === i ? "var(--enforced)" : n < i ? "var(--lav-deep)" : "rgb(255 255 255 / 0.18)" }}
            />
          ))}
        </div>
        <span className="hidden font-mono text-[10px] text-text-faint md:inline">← → to move · F fullscreen</span>
        <div className="flex gap-2">
          <button onClick={() => go(i - 1)} disabled={i === 0} aria-label="previous slide"
            className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-text-dim transition hover:border-white/30 hover:text-text disabled:opacity-30">←</button>
          <button onClick={() => go(i + 1)} disabled={i === last} aria-label="next slide"
            className="grid h-10 w-10 place-items-center rounded-full border-2 border-[#16161a] bg-[#fdfcff] font-semibold text-[#16161a] transition disabled:opacity-30"
            style={{ boxShadow: "3px 3px 0 0 var(--lav-deep)" }}>→</button>
        </div>
      </footer>
    </main>
  );
}
