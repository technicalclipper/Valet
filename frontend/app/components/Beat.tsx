import { AssertRow } from "./AssertRow";
import type { AssertName } from "../../lib/chain/reads";

function fmt(v: bigint, decimals = 6): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * One half of the demo, and both halves are live.
 *
 * The verdict comes from calling preflight() on the deployed capsule — a real
 * eth_call against real state, not a scripted animation. It needs no private
 * key, which is why the homepage can show the chain refusing something without
 * anyone signing anything.
 */
export function Beat({
  amount,
  verdict,
  cap,
}: {
  amount: bigint;
  verdict: AssertName;
  cap: bigint;
}) {
  const refused = verdict !== "NONE";
  return (
    <div
      className="relative overflow-hidden rounded-lg border bg-ink-2/70 p-5 backdrop-blur"
      style={{
        borderColor: refused ? "rgb(253 121 174 / 0.4)" : "rgb(178 255 166 / 0.3)",
      }}
    >
      <div className="flex items-baseline justify-between">
        <code className="font-mono text-[13px] text-text-dim">
          execute <span className="text-text">{fmt(amount)} USDC</span>
        </code>
        <span
          className="font-mono text-[11px] uppercase tracking-[0.14em]"
          style={{ color: refused ? "var(--refused)" : "var(--enforced)" }}
        >
          {refused ? "refused" : "executes"}
        </span>
      </div>

      <p className="mt-2 text-[13px] leading-snug text-text-dim">
        {refused ? (
          <>
            Four times its cap, against a book that would happily have filled it. The refusal comes
            from the capsule, not the venue — and the cap is {fmt(cap)} USDC.
          </>
        ) : (
          <>
            Inside every bound. The agent picks the venue and writes the calldata, and never holds
            the money: it goes contract → venue → contract → beneficiary in one transaction.
          </>
        )}
      </p>

      <div className="mt-4">
        <AssertRow refusedBy={verdict} />
      </div>
    </div>
  );
}
