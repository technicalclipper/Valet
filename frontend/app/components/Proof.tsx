import type { ReactNode } from "react";

/**
 * The evidence, folded away.
 *
 * Collapsing proof feels like hiding it, which is why the summary states what is
 * inside and what it establishes. Someone who wants to check can; someone being
 * handed a permission is not made to read a hash to find out what they have
 * been given.
 */
export function Proof({
  title,
  summary,
  children,
  tone = "neutral",
}: {
  title: string;
  summary: string;
  children: ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  const color =
    tone === "good" ? "var(--enforced)" : tone === "bad" ? "var(--refused)" : "var(--text-dim)";
  return (
    <details className="group rounded-lg border border-white/[0.07] bg-ink-2/40 open:bg-ink-2/70">
      <summary className="flex cursor-pointer list-none items-baseline gap-3 px-4 py-3 hover:bg-white/[0.02]">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color }}>
          {title}
        </span>
        <span className="text-[13px] text-text-faint">{summary}</span>
        <span className="ml-auto font-mono text-[11px] text-text-faint transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="border-t border-white/[0.06] px-4 py-4">{children}</div>
    </details>
  );
}
