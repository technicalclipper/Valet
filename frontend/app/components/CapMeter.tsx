function fmt(v: bigint, decimals = 6): string {
  const s = v.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * The hero element, and where the design diverges hardest from its inspiration.
 * Metropolis's floor bloom recedes into open space; this closes in. A fill that
 * rushes up and stops dead at a line.
 *
 * Three regions, and keeping them visually distinct matters more than it
 * sounds: a first attempt tinted the whole soft-cap span in the fill's own
 * gradient, and an untouched capsule read as half spent. Only what has actually
 * moved gets the bright fill.
 *
 *   fill        what has moved
 *   escalation  between the soft cap and the wall — reachable only with an
 *               approved escalation, so it is drawn as empty space, faintly
 *               marked rather than coloured in
 *   wall        the hard cap, which nothing lifts
 */
export function CapMeter({
  label,
  spent,
  soft,
  hard,
  unit = "USDC",
}: {
  label: string;
  spent: bigint;
  soft: bigint;
  hard: bigint;
  unit?: string;
}) {
  const scale = hard > 0n ? hard : 1n;
  const pct = (v: bigint) => Math.min(Number((v * 10_000n) / scale) / 100, 100);
  const spentPct = pct(spent);
  const softPct = pct(soft);
  const hasEscalationRoom = soft < hard;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">{label}</span>
        <span className="font-mono text-xs">
          <span style={{ color: spent > 0n ? "var(--peri)" : "var(--text-faint)" }}>{fmt(spent)}</span>
          <span className="text-text-faint"> of {fmt(soft)} {unit}</span>
        </span>
      </div>

      <div className="relative mt-2 h-9 overflow-hidden rounded border border-white/[0.07] bg-ink-3/80">
        {/* the grid tightens toward the wall: containment, not a horizon */}
        <div className="grid-closing absolute inset-0 opacity-50" />

        {/* reachable only with an approved escalation — marked, not filled */}
        {hasEscalationRoom && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${softPct}%`,
              right: 0,
              background:
                "repeating-linear-gradient(135deg, transparent 0 5px, rgb(194 181 255 / 0.10) 5px 6px)",
            }}
            title="only an approved escalation reaches here"
          />
        )}

        {/* what has actually moved */}
        {spentPct > 0 && (
          <div
            className="fill-bar absolute inset-y-0 left-0"
            style={{ ["--fill" as string]: `${spentPct}%`, width: `${spentPct}%`, background: "var(--slab-l)" }}
          />
        )}

        {/* the soft cap, which an escalation may lift */}
        {hasEscalationRoom && (
          <div className="absolute inset-y-0 w-px bg-white/30" style={{ left: `${softPct}%` }} title="soft cap" />
        )}

        {/* the wall */}
        <div
          className="absolute inset-y-0 right-0 w-[3px]"
          style={{ background: "var(--refused)", boxShadow: "0 0 14px rgb(253 121 174 / 0.6)" }}
          title="hard cap — nothing lifts this"
        />
      </div>

      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[10px]">
        <span className="text-text-faint">
          {hasEscalationRoom ? `soft ${fmt(soft)} · escalation room to ${fmt(hard)}` : `cap ${fmt(soft)}`}
        </span>
        <span style={{ color: "var(--refused)" }}>nothing lifts the wall</span>
      </div>
    </div>
  );
}
