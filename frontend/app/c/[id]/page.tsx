import Link from "next/link";
import { Header } from "../../components/Header";
import { Verdicts } from "../../components/Verdicts";
import { CapMeter } from "../../components/CapMeter";
import { AssertRow } from "../../components/AssertRow";
import { VerificationBadge } from "../../components/VerificationBadge";
import { loadPolicy } from "../../../lib/policy/store";
import { readCapsule, readHeadroom, preflight, readVault, type AssertName } from "../../../lib/chain/reads";
import { readHistory } from "../../../lib/chain/events";
import { verifyCapsule } from "../../../lib/chain/verify";
import { addresses, chain } from "../../../lib/config/chain";

export const dynamic = "force-dynamic";

function fmt(v: bigint, decimals = 6): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

const MODE = ["back to the vault", "to the recipient", "to a fixed address"];

export default async function CapsulePage(props: PageProps<"/c/[id]">) {
  // Next 16: params is async-only. Synchronous access was removed.
  const { id } = await props.params;
  const capsuleId = BigInt(id);

  const [capsule, policy] = await Promise.all([readCapsule(capsuleId), loadPolicy(id)]);
  const [vault, head] = await Promise.all([readVault(capsule.vaultId), readHeadroom(capsuleId)]);

  const verification = policy ? verifyCapsule(policy, capsule) : null;

  // Ask the contract what it would say to a spend of exactly one action's worth.
  let refusedBy: AssertName = "NONE";
  if (capsule.holder !== "0x0000000000000000000000000000000000000000") {
    const quoted = 10n ** 18n;
    refusedBy = await preflight(
      {
        capsuleId,
        vaultId: capsule.vaultId,
        amountIn: capsule.bounds.perAction,
        quotedOut: quoted,
        minOut: (quoted * BigInt(10_000 - capsule.bounds.maxSlippageBps)) / 10_000n,
        target: addresses.kuruMarket,
        recipient: capsule.mode === 1 ? capsule.principal : capsule.mode === 2 ? capsule.fixedBeneficiary : (addresses.valet as `0x${string}`),
      },
      capsule.holder,
    ).catch(() => "NONE" as AssertName);
  }

  const history = await readHistory(capsuleId).catch(() => []);
  const state = capsule.revoked
    ? "revoked"
    : capsule.surrendered
      ? "handed back"
      : capsule.pausedByIssuer || capsule.pausedByPrincipal
        ? "paused"
        : capsule.holder === "0x0000000000000000000000000000000000000000"
          ? "unclaimed"
          : "live";

  return (
    <>
      <Header />
      <main className="grid-field min-h-screen">
        <div className="mx-auto max-w-6xl space-y-8 px-6 py-10">
          <div>
            <p className="eyebrow">capsule #{id}</p>
            <h1 className="sheen relative mt-1 overflow-hidden text-2xl font-medium tracking-tight sm:text-3xl">
              {policy?.source ?? "a permission with no document on file"}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-text-faint">
              <span style={{ color: state === "live" ? "var(--enforced)" : "var(--refused)" }}>{state}</span>
              <span>·</span>
              <span>proceeds {MODE[capsule.mode]}</span>
              <span>·</span>
              <span>vault holds {fmt(vault.balance)} USDC</span>
            </p>
          </div>

          {verification ? (
            <VerificationBadge v={verification} />
          ) : (
            <p className="rounded-lg border border-white/[0.07] bg-ink-2/60 p-4 text-[13px] text-text-dim">
              No policy document on file for this capsule, so the terms cannot be checked against the
              chain. The capsule's own numbers are still shown below — they are the thing that
              binds either way.
            </p>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-6 rounded-lg border border-white/[0.07] bg-ink-2/60 p-5">
              <CapMeter
                label="today"
                spent={capsule.bounds.perWindow - head.windowLeft}
                soft={capsule.bounds.perWindow}
                hard={capsule.bounds.hardCap}
              />
              <CapMeter
                label="lifetime"
                spent={capsule.spentTotal}
                soft={capsule.bounds.totalCap}
                hard={capsule.bounds.totalCap}
              />
              <dl className="grid grid-cols-2 gap-y-2 font-mono text-[11px]">
                <dt className="text-text-faint">window</dt>
                <dd>{Number(head.windowIndex) + 1} of {capsule.bounds.windows}</dd>
                <dt className="text-text-faint">slippage bound</dt>
                <dd>{capsule.bounds.maxSlippageBps / 100}%</dd>
                <dt className="text-text-faint">holder</dt>
                <dd className="truncate">{capsule.holder === "0x0000000000000000000000000000000000000000" ? "unclaimed" : capsule.holder}</dd>
              </dl>
            </section>

            <section className="rounded-lg border border-white/[0.07] bg-ink-2/60 p-5">
              <AssertRow refusedBy={refusedBy} />
            </section>
          </div>

          {policy && (
            <div>
              <p className="eyebrow mb-3">what was asked for, and what the chain will keep</p>
              <Verdicts clauses={policy.clauses} />
            </div>
          )}

          <section>
            <p className="eyebrow mb-3">history, rebuilt from the chain&apos;s own events</p>
            <ol className="space-y-1.5 font-mono text-[11px]">
              {history.length === 0 && <li className="text-text-faint">nothing recorded yet</li>}
              {history.map((h, i) => (
                <li key={`${h.txHash}-${i}`} className="flex flex-wrap items-baseline gap-x-3 border-l border-white/10 pl-3">
                  <span style={{ color: "var(--peri)" }}>{h.kind}</span>
                  <span className="text-text-faint">block {h.blockNumber.toString()}</span>
                  {Object.entries(h.detail).slice(0, 3).map(([k, val]) => (
                    <span key={k} className="text-text-dim">
                      {k}=<span className="text-text">{val.length > 14 ? `${val.slice(0, 10)}…` : val}</span>
                    </span>
                  ))}
                  <a
                    href={`${chain.explorer}/tx/${h.txHash}`}
                    className="ml-auto text-text-faint underline decoration-dotted hover:text-text"
                    target="_blank"
                    rel="noreferrer"
                  >
                    tx
                  </a>
                </li>
              ))}
            </ol>
          </section>

          <Link href="/" className="inline-block text-xs text-text-faint hover:text-text">
            ← home
          </Link>
        </div>
      </main>
    </>
  );
}
