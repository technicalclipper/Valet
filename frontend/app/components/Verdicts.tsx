import type { Clause, Verdict } from "../../lib/policy/types";

const STYLE: Record<Verdict, { pop: string; ink: string; glyph: string; label: string; blurb: string }> = {
  refused: {
    pop: "#d8366f",
    ink: "#b5245a",
    glyph: "✗",
    label: "Refused",
    blurb: "We will not pretend to support these. Nothing mints while one stands.",
  },
  enforced: {
    pop: "#2f9e5e",
    ink: "#1f7a46",
    glyph: "✓",
    label: "Enforced",
    blurb: "Checked on chain, on every spend. Ignore one and the transaction reverts.",
  },
  advisory: {
    pop: "#7e65d4",
    ink: "#5b45a8",
    glyph: "~",
    label: "Advisory",
    blurb: "The agent is told. Nothing makes it obey, and saying so is the point.",
  },
};

/**
 * The three buckets.
 *
 * Ordered by what the reader needs first, not by the enum: a refusal blocks the
 * mint, so it leads when there is one. Giving all three equal width looked
 * balanced and was useless — two of them are usually empty, and a column of
 * "none" earned a third of the page for saying nothing. Empty buckets now
 * collapse to a line.
 *
 * The ribbon exists because the split is the thing worth seeing before any of
 * the words: nine green and nothing else is a different feeling from eight
 * green and one red, and it should land before you start reading.
 */
export function Verdicts({ clauses }: { clauses: Clause[] }) {
  const by = (v: Verdict) => clauses.filter((c) => c.verdict === v);
  const groups = { enforced: by("enforced"), advisory: by("advisory"), refused: by("refused") };
  const total = clauses.length || 1;

  // a blocker first; otherwise the terms, then the caveats
  const order: Verdict[] = groups.refused.length
    ? ["refused", "enforced", "advisory"]
    : ["enforced", "advisory", "refused"];
  const shown = order.filter((v) => groups[v].length > 0);
  const empty = order.filter((v) => groups[v].length === 0);

  return (
    <div className="space-y-4">
      {/* the split, before any of the words */}
      <div>
        <div className="flex h-2.5 overflow-hidden rounded-full border-2" style={{ borderColor: "#16161a" }}>
          {(["enforced", "advisory", "refused"] as Verdict[]).map((v) =>
            groups[v].length ? (
              <div
                key={v}
                className="fill-bar"
                style={{
                  ["--fill" as string]: `${(groups[v].length / total) * 100}%`,
                  width: `${(groups[v].length / total) * 100}%`,
                  background: STYLE[v].pop,
                }}
              />
            ) : null,
          )}
        </div>
        <p className="mt-2 flex flex-wrap gap-x-4 font-mono text-[11px]">
          {(["enforced", "advisory", "refused"] as Verdict[]).map((v) => (
            <span key={v} style={{ color: groups[v].length ? STYLE[v].pop : "var(--text-faint)" }}>
              {groups[v].length} {v}
            </span>
          ))}
        </p>
      </div>

      {shown.map((v) => {
        const s = STYLE[v];
        const items = groups[v];
        const wide = items.length > 5;
        return (
          <section key={v} className="card-pop card-enter p-5" style={{ ["--pop" as string]: s.pop }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold tracking-tight on-card">{s.label}</h3>
                <p className="mt-0.5 max-w-md text-[13px] on-card-faint">{s.blurb}</p>
              </div>
              <span
                className="shrink-0 font-mono text-4xl font-bold leading-none tabular-nums"
                style={{ color: s.pop }}
              >
                {items.length}
              </span>
            </div>

            <ul className={`mt-4 gap-x-8 ${wide ? "sm:columns-2" : ""}`}>
              {items.map((c, i) => (
                <li
                  key={`${c.text}-${i}`}
                  className="row-in mb-3 break-inside-avoid"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-[12px]" style={{ color: s.ink }}>
                      {s.glyph}
                    </span>
                    <span className="text-[14px] font-medium leading-snug on-card">{c.text}</span>
                  </div>
                  <p className="ml-[1.1rem] mt-0.5 text-[12px] leading-snug on-card-dim">{c.because}</p>
                  {c.boundTo && (
                    <code
                      className="ml-[1.1rem] mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[10px]"
                      style={{ background: "rgb(22 22 26 / 0.06)", color: "#5c5c6e" }}
                    >
                      {c.boundTo}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {empty.length > 0 && (
        <p className="font-mono text-[11px] text-text-faint">
          {empty.map((v) => `nothing ${v}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
