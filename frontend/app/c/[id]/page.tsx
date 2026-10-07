import Link from "next/link";
import { Header } from "../../components/Header";
import { CapMeter } from "../../components/CapMeter";
import { Proof } from "../../components/Proof";
import { ChecksList } from "../../components/ChecksList";
import { decodeSentence, loadPolicy } from "../../../lib/policy/store";
import { readCapsule, readHeadroom, preflight, readVault, type AssertName } from "../../../lib/chain/reads";
import { readHistory } from "../../../lib/chain/events";
import { verifyCapsule } from "../../../lib/chain/verify";
import { addresses, chain } from "../../../lib/config/chain";
import { BENEFICIARY, amount, bare, cadence, percent, shortAddress, when } from "../../../lib/format";

export const dynamic = "force-dynamic";
const ZERO = "0x0000000000000000000000000000000000000000";

export default async function CapsulePage(props: PageProps<"/c/[id]">) {
  // Next 16: params is async-only.
  // Next 16: params and searchParams are both async-only.
  const [{ id }, query] = await Promise.all([props.params, props.searchParams]);
  const capsuleId = BigInt(id);

  const capsule = await readCapsule(capsuleId);

  // A link may carry the sentence it was written from. Recompiling it against
  // the capsule's own notBefore reproduces the document without anyone having
  // stored it — and the hash check then has nothing to trust but the chain.
  const linked = typeof query.s === "string" ? decodeSentence(query.s) : null;
  const policy = await loadPolicy(
    id,
    linked ? { sentence: linked, notBefore: Number(capsule.bounds.notBefore) } : undefined,
  );
  const [vault, head] = await Promise.all([readVault(capsule.vaultId), readHeadroom(capsuleId)]);
  const verification = policy ? verifyCapsule(policy, capsule) : null;
  const b = capsule.bounds;

  let refusedBy: AssertName = "NONE";
  if (capsule.holder !== ZERO) {
    const quoted = 10n ** 18n;
    refusedBy = await preflight(
      {
        capsuleId,
        vaultId: capsule.vaultId,
        amountIn: b.perAction,
        quotedOut: quoted,
        minOut: (quoted * BigInt(10_000 - b.maxSlippageBps)) / 10_000n,
        target: addresses.kuruMarket,
        recipient: capsule.mode === 1 ? capsule.principal : capsule.mode === 2 ? capsule.fixedBeneficiary : (addresses.valet as `0x${string}`),
      },
      capsule.holder,
    ).catch(() => "NONE" as AssertName);
  }

  const history = await readHistory(capsuleId).catch(() => []);
  const ended = capsule.revoked || capsule.surrendered;
  const paused = capsule.pausedByIssuer || capsule.pausedByPrincipal;
  const unclaimed = capsule.holder === ZERO;

  const status = capsule.revoked
    ? { word: "Revoked", tone: "var(--refused)", line: "The issuer ended this. Nothing further can be spent." }
    : capsule.surrendered
      ? { word: "Handed back", tone: "var(--refused)", line: "You returned this permission. Nothing further can be spent." }
      : paused
        ? { word: "Paused", tone: "var(--advisory)", line: "On hold. No spend will go through until it is resumed." }
        : unclaimed
          ? { word: "Granted", tone: "var(--enforced)", line: "Waiting for you to choose who acts on it." }
          : { word: "Live", tone: "var(--enforced)", line: "An agent is acting on this inside the limits below." };

  const day = Number(head.windowIndex) + 1;
  const enforced = policy?.clauses.filter((c) => c.verdict === "enforced") ?? [];
  const advisory = policy?.clauses.filter((c) => c.verdict === "advisory") ?? [];
  const refused = policy?.clauses.filter((c) => c.verdict === "refused") ?? [];

  /**
   * The sentence a recipient actually needs, assembled from the chain.
   *
   * Mode-aware, because the three beneficiary modes are three different offers.
   * In VAULT mode nothing is being given to the reader at all — they are the
   * accountable human operating an agent over someone else's money — and
   * "you are being given" would be simply false.
   */
  const span = `${cadence(b.windowLength)} for ${b.windows} ${
    Number(b.windowLength) === 86400 ? "days" : "periods"
  }`;
  const lead =
    capsule.mode === 1
      ? { opener: "You are being given", body: `${amount(b.perAction)} of MON, ${span}.` }
      : capsule.mode === 2
        ? {
            opener: "An agent may spend",
            body: `${amount(b.perAction)} ${span}, with the MON paid to ${shortAddress(capsule.fixedBeneficiary)}.`,
          }
        : {
            opener: "You are trusted to run an agent that spends",
            body: `${amount(b.perAction)} ${span}. The proceeds stay in the issuer's vault — none of it becomes yours.`,
          };

  return (
    <>
      <Header />
      <main className="min-h-screen">
        {/* --- the answer ------------------------------------------------ */}
        <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
          <div className="grid-field absolute inset-0 -z-10 opacity-40" />
          <div className="mx-auto max-w-5xl px-6 py-12">
            <p className="eyebrow">capsule #{id}</p>

            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <h1 className="text-4xl font-medium tracking-tight sm:text-5xl" style={{ color: status.tone }}>
                {status.word}
              </h1>
              {verification && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]"
                  style={{
                    borderColor: verification.verified ? "rgb(178 255 166 / 0.3)" : "rgb(253 121 174 / 0.4)",
                    color: verification.verified ? "var(--enforced)" : "var(--refused)",
                  }}
                >
                  {verification.verified ? "⛓ verified" : "⚠ not verified"}
                </span>
              )}
            </div>

            <p className="mt-3 max-w-2xl text-xl leading-snug text-text-dim sm:text-2xl">
              {lead.opener} <span className="text-text">{lead.body}</span>
            </p>
            <p className="mt-2 text-[13px] text-text-faint">{status.line}</p>

            {/* the four numbers that matter, in words */}
            <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {([
                ["each day", amount(b.perAction), "#7e65d4"],
                ["for", `${b.windows} days`, "#c2b5ff"],
                ["the MON goes", BENEFICIARY[capsule.mode], "#2f9e5e"],
                ["worst fill accepted", percent(b.maxSlippageBps), "#d8366f"],
              ] as const).map(([k, v, pop]) => (
                <div key={k} className="card-pop card-pop--lift px-4 py-3.5" style={{ ["--pop" as string]: pop }}>
                  <dt className="eyebrow">{k}</dt>
                  <dd className="mt-1 text-xl font-semibold tracking-tight on-card">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <div className="mx-auto max-w-5xl space-y-10 px-6 py-10">
          {/* --- where it has got to ------------------------------------ */}
          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">Where it has got to</h2>
              <p className="font-mono text-[11px] text-text-faint">
                day {day} of {b.windows} · {when(b.notBefore)} → {when(b.expiresAt)}
              </p>
            </div>
            <div className="mt-4 grid gap-5 rounded-lg border border-white/[0.07] bg-ink-2/50 p-5 sm:grid-cols-2">
              <CapMeter label="today" spent={b.perWindow - head.windowLeft} soft={b.perWindow} hard={b.hardCap} />
              <CapMeter label="all thirty days" spent={capsule.spentTotal} soft={b.totalCap} hard={b.totalCap} />
            </div>
            <p className="mt-2 text-[13px] text-text-faint">
              The vault holds {amount(vault.balance)}. An unused day is forfeited, not saved —
              skipping three days does not buy a larger trade later.
            </p>
          </section>

          {/* --- may / may not ------------------------------------------ */}
          {policy && (
            <section className="grid gap-5 lg:grid-cols-2">
              <div className="card-pop p-5" style={{ ["--pop" as string]: "#2f9e5e" }}>
                <h2 className="text-base font-semibold on-card">What the agent may do</h2>
                <p className="mt-1 text-[13px] on-card-faint">
                  Checked on chain, on every spend. {enforced.length} terms.
                </p>
                <ul className="mt-3 space-y-2">
                  {enforced.map((c, i) => (
                    <li key={i} className="flex items-baseline gap-2.5 text-[13px]">
                      <span className="font-mono text-[11px]" style={{ color: "#2f9e5e" }}>✓</span>
                      <span className="on-card-dim">{c.text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="card-pop p-5" style={{ ["--pop" as string]: "#d8366f" }}>
                <h2 className="text-base font-semibold on-card">What it may not</h2>
                <p className="mt-1 text-[13px] on-card-faint">
                  Not a policy we enforce — a transaction that cannot be built.
                </p>
                <ul className="mt-3 space-y-2 text-[13px]">
                  {[
                    `spend more than ${bare(b.hardCap)} USDC in one go, even if the issuer approves it`,
                    "trade anywhere but the allowlisted venue",
                    `accept a fill worse than ${percent(b.maxSlippageBps)}`,
                    `send the proceeds anywhere but ${BENEFICIARY[capsule.mode]}`,
                    "hold the money at any point — it never leaves the contract",
                  ].map((t) => (
                    <li key={t} className="flex items-baseline gap-2.5">
                      <span className="font-mono text-[11px]" style={{ color: "#d8366f" }}>✗</span>
                      <span className="on-card-dim">{t}</span>
                    </li>
                  ))}
                </ul>
                {(advisory.length > 0 || refused.length > 0) && (
                  <p className="mt-3 text-[11px] on-card-faint">
                    {advisory.length} advisory {advisory.length === 1 ? "clause" : "clauses"} passed to
                    the agent as instructions · {refused.length} refused at compose time
                  </p>
                )}
              </div>
            </section>
          )}

          {/* --- the proof, folded away ---------------------------------- */}
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Check it yourself</h2>

            {verification && (
              <Proof
                title="the terms against the chain"
                summary={
                  verification.verified
                    ? "Both checks pass: this document is the one hashed at mint, and the capsule implements it."
                    : "One of the two checks failed."
                }
                tone={verification.verified ? "good" : "bad"}
              >
                <p className="text-[13px] leading-relaxed on-card-dim">
                  Two checks, answering different questions. The hash says this document is the one
                  hashed at mint. The field list says the capsule on chain actually implements it — a
                  server could do the first honestly and still mint something else, and only the
                  second rules that out.
                </p>
                <dl className="mt-4 space-y-1 font-mono text-[11px] on-card-dim">
                  <div className="flex flex-wrap gap-2">
                    <dt className="w-40 shrink-0 on-card-faint">document hashed</dt>
                    <dd className="break-all" style={{ color: verification.hashMatches ? "var(--enforced)" : "var(--refused)" }}>
                      {verification.documentHash}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <dt className="w-40 shrink-0 on-card-faint">capsule.policyHash</dt>
                    <dd className="break-all" style={{ color: verification.hashMatches ? "var(--enforced)" : "var(--refused)" }}>
                      {verification.chainHash}
                    </dd>
                  </div>
                </dl>
                <table className="mt-4 w-full text-left font-mono text-[11px]">
                  <thead>
                    <tr className="on-card-faint">
                      <th className="pb-1 font-normal">field</th>
                      <th className="pb-1 font-normal">in the document</th>
                      <th className="pb-1 font-normal">on chain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {verification.fields.map((f) => (
                      <tr key={f.field} className="rule border-t">
                        <td className="py-1 on-card-dim">
                          <span style={{ color: f.ok ? "#2f9e5e" : "#d8366f" }}>
                            {f.ok ? "✓" : "✗"}
                          </span>{" "}
                          {f.field}
                        </td>
                        <td className="py-1 on-card-faint">{f.document.length > 20 ? `${f.document.slice(0, 18)}…` : f.document}</td>
                        <td className="py-1 on-card">{f.chain.length > 20 ? `${f.chain.slice(0, 18)}…` : f.chain}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Proof>
            )}

            <Proof
              title="the nineteen checks"
              summary={
                refusedBy === "NONE"
                  ? `All nineteen pass for a spend of ${amount(b.perAction)} right now.`
                  : `A spend of ${amount(b.perAction)} would be refused: ${refusedBy}.`
              }
              tone={refusedBy === "NONE" ? "good" : "bad"}
            >
              <p className="mb-4 text-[13px] leading-relaxed on-card-dim">
                Asked of the contract, not worked out here: these come from{" "}
                <code className="font-mono on-card">preflight()</code>, which shares its body with
                the function that actually charges — so this list cannot promise anything the chain
                would refuse.
              </p>
              <ChecksList refusedBy={refusedBy} />
            </Proof>

            <Proof
              title="history"
              summary={`${history.length} ${history.length === 1 ? "event" : "events"}, rebuilt from the chain rather than from anything we wrote down.`}
            >
              <ol className="space-y-2 text-[13px]">
                {history.length === 0 && <li className="on-card-faint">nothing recorded yet</li>}
                {history.map((h, i) => (
                  <li key={`${h.txHash}-${i}`} className="rule flex flex-wrap items-baseline gap-x-3 border-l pl-3">
                    <span className="font-medium" style={{ color: "#5b45a8" }}>{h.kind}</span>
                    <span className="font-mono text-[11px] on-card-faint">block {h.blockNumber.toString()}</span>
                    <a
                      href={`${chain.explorer}/tx/${h.txHash}`}
                      className="ml-auto font-mono text-[11px] on-card-faint underline decoration-dotted"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(h.txHash)}
                    </a>
                  </li>
                ))}
              </ol>
            </Proof>

            <Proof title="who holds what" summary="The three parties, and the keys behind them.">
              <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
                {[
                  ["issuer — may revoke, pause, top up, tighten", capsule.issuer],
                  ["you — may pause or hand it back", capsule.principal],
                  ["the agent — may execute, and nothing else", unclaimed ? "not chosen yet" : capsule.holder],
                  ["venue", addresses.kuruMarket],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="eyebrow">{k}</dt>
                    <dd className="mt-0.5 font-mono text-[11px] on-card-dim">{v.startsWith("0x") ? shortAddress(v) : v}</dd>
                  </div>
                ))}
              </dl>
            </Proof>
          </section>

          {!ended && (
            <p className="text-[13px] text-text-faint">
              You can pause this or hand it back at any time, and it costs you nothing — your
              signature is relayed, so you never need to hold a token to use it.
            </p>
          )}

          <Link href="/" className="inline-block text-xs text-text-faint hover:text-text">
            ← home
          </Link>
        </div>
      </main>
    </>
  );
}
