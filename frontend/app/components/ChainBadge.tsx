import { chain } from "../../lib/config/chain";

/**
 * Always visible, never configurable from the page.
 *
 * A demo video must not be able to pass a local fork off as mainnet. Anyone
 * watching can read which chain the numbers came from, which means the fork
 * footage can do the thing mainnet cannot — compress thirty days into a minute —
 * without the honesty of the rest being in question.
 */
export function ChainBadge() {
  const live = chain.isMainnet;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em]"
      style={{
        borderColor: live ? "rgb(178 255 166 / 0.35)" : "rgb(253 121 174 / 0.35)",
        color: live ? "var(--enforced)" : "var(--refused)",
        background: live ? "rgb(178 255 166 / 0.06)" : "rgb(253 121 174 / 0.06)",
      }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${live ? "pulse-live" : ""}`}
        style={{ background: live ? "var(--enforced)" : "var(--refused)" }}
      />
      {chain.label}
      {!live && <span className="text-text-faint normal-case tracking-normal">· time accelerated</span>}
    </span>
  );
}
