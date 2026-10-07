import type { Verification } from "../../lib/chain/verify";
import { verdictLine } from "../../lib/chain/verify";

/**
 * Two checks, shown as two checks.
 *
 * It would be easy to render one tick and call it verified. But the checks
 * answer different questions — whether the document is the one hashed at mint,
 * and whether the capsule on chain actually implements it — and the second is
 * the one that catches a server showing you one policy and minting another.
 * Collapsing them would hide the more interesting guarantee.
 */
export function VerificationBadge({ v }: { v: Verification }) {
  const ok = v.verified;
  return (
    <section
      className="rounded-lg border p-4"
      style={{
        borderColor: ok ? "rgb(178 255 166 / 0.3)" : "rgb(253 121 174 / 0.35)",
        background: ok ? "rgb(178 255 166 / 0.04)" : "rgb(253 121 174 / 0.05)",
      }}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm" style={{ color: ok ? "var(--enforced)" : "var(--refused)" }}>
          {ok ? "⛓ Verified" : "⚠ Not verified"}
        </span>
        <span className="text-[13px] text-text-dim">{verdictLine(v)}</span>
      </div>

      <dl className="mt-3 space-y-1.5 font-mono text-[11px]">
        <div className="flex gap-2">
          <dt className="w-44 shrink-0 text-text-faint">document hashed</dt>
          <dd className="truncate" style={{ color: v.hashMatches ? "var(--enforced)" : "var(--refused)" }}>
            {v.documentHash}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-44 shrink-0 text-text-faint">capsule.policyHash</dt>
          <dd className="truncate" style={{ color: v.hashMatches ? "var(--enforced)" : "var(--refused)" }}>
            {v.chainHash}
          </dd>
        </div>
      </dl>

      <p className="eyebrow mt-4">and the capsule's own numbers</p>
      <ul className="mt-1.5 grid gap-x-6 gap-y-1 font-mono text-[11px] sm:grid-cols-2">
        {v.fields.map((f) => (
          <li key={f.field} className="flex items-baseline gap-2">
            <span style={{ color: f.ok ? "var(--enforced)" : "var(--refused)" }}>{f.ok ? "✓" : "✗"}</span>
            <span className="text-text-faint">{f.field}</span>
            <span className="ml-auto text-text-dim">{f.ok ? f.chain : `${f.document} ≠ ${f.chain}`}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-snug text-text-faint">
        The hash says this document is the one hashed at mint. The field list says the capsule on
        chain actually implements it. A server could do the first honestly and still mint something
        else — only the second rules that out.
      </p>
    </section>
  );
}
