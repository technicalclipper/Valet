import type { Clause, Verdict } from "../../lib/policy/types";

const STYLE: Record<Verdict, { color: string; label: string; blurb: string }> = {
  enforced: {
    color: "var(--enforced)",
    label: "Enforced",
    blurb: "The chain checks this. Ignore it and the transaction reverts.",
  },
  advisory: {
    color: "var(--advisory)",
    label: "Advisory",
    blurb: "The agent is told. Nothing makes it obey.",
  },
  refused: {
    color: "var(--refused)",
    label: "Refused",
    blurb: "Not expressible, or honouring it would undo the point.",
  },
};

/**
 * The three buckets, shown before anything mints.
 *
 * This is the part of the product nobody else has, so it gets the neon and the
 * top of the page. The honesty is the feature: an advisory clause is labelled as
 * one rather than dressed up as a limit.
 */
export function Verdicts({ clauses }: { clauses: Clause[] }) {
  const order: Verdict[] = ["enforced", "advisory", "refused"];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {order.map((verdict) => {
        const items = clauses.filter((c) => c.verdict === verdict);
        const s = STYLE[verdict];
        return (
          <section
            key={verdict}
            className="rounded-lg border border-white/[0.07] bg-ink-2/60 p-4"
            style={{ borderTopColor: s.color, borderTopWidth: 2 }}
          >
            <h3 className="flex items-baseline justify-between">
              <span className="eyebrow" style={{ color: s.color }}>
                {s.label}
              </span>
              <span className="font-mono text-xs text-text-faint">{items.length}</span>
            </h3>
            <p className="mt-1 text-[11px] leading-snug text-text-faint">{s.blurb}</p>
            <ul className="mt-3 space-y-2.5">
              {items.length === 0 && (
                <li className="text-xs text-text-faint/60">none</li>
              )}
              {items.map((c, i) => (
                <li key={`${c.text}-${i}`} className="tick-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <p className="text-[13px] leading-snug text-text">{c.text}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-text-dim">{c.because}</p>
                  {c.boundTo && (
                    <code className="mt-1 inline-block font-mono text-[10px] text-text-faint">
                      {c.boundTo}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
