import Link from "next/link";
import { AccountChip } from "./AccountChip";
import { ChainBadge } from "./ChainBadge";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/" className="group flex shrink-0 items-baseline gap-2">
          <span className="font-mono text-lg leading-none">⇥</span>
          <span className="text-sm font-medium tracking-tight">Valet</span>
          <span className="hidden text-xs text-text-faint sm:inline">
            bounded authority for agents
          </span>
        </Link>
        <div className="flex items-center gap-2.5">
          <Link href="/me" className="hidden whitespace-nowrap font-mono text-[11px] text-text-dim transition hover:text-text sm:inline">
            your capsules
          </Link>
          <ChainBadge />
          <AccountChip />
        </div>
      </div>
    </header>
  );
}
