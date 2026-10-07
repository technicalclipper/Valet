import type { ReactNode } from "react";

/**
 * The evidence, folded away.
 *
 * Collapsing proof risks looking like hiding it, which is why the summary
 * carries the finding rather than just a label. Someone who wants to check can;
 * someone being handed a permission is not made to read a hash to find out what
 * they have been given.
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
  // the shadow carries the verdict, so a row's state reads before it is opened
  const pop =
    tone === "good" ? "#2f9e5e" : tone === "bad" ? "#d8366f" : "var(--lav-deep)";
  return (
    <details className="card-pop group" style={{ ["--pop" as string]: pop }}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] on-card">{title}</span>
        <span className="text-[13px] on-card-dim">{summary}</span>
        <span className="ml-auto font-mono text-[11px] on-card-faint transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="rule border-t px-4 py-4">{children}</div>
    </details>
  );
}
