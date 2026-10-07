"use client";

import { CopyChip } from "./CopyChip";
import { amount } from "../../lib/format";

/**
 * Who you are signed in as, and what that wallet holds.
 *
 * Given its own card because it answers a question people ask twice: which
 * account is this, and can it actually pay. The balances sit next to the
 * address rather than in a toast, since "0 USDC" is the reason a mint button
 * will be disabled and the two facts belong together.
 */
export function Identity({
  email,
  address,
  usdc,
  mon,
  onDisconnect,
}: {
  email?: string;
  address?: string;
  usdc?: bigint;
  mon?: bigint;
  onDisconnect?: () => void;
}) {
  if (!address) return null;
  const broke = usdc !== undefined && usdc === 0n;

  return (
    <div className="card-pop card-enter p-4" style={{ ["--pop" as string]: "#7e65d4" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5">
          <span className="breathe h-2 w-2 rounded-full" style={{ background: "#2f9e5e" }} />
          <span className="text-sm font-semibold on-card">Signed in</span>
        </span>

        {usdc !== undefined && mon !== undefined && (
          <span className="ml-auto flex items-baseline gap-3 font-mono text-[12px]">
            <span style={{ color: broke ? "#d8366f" : "#16161a" }}>{amount(usdc)}</span>
            <span className="on-card-faint">{amount(mon, 18, "MON")}</span>
          </span>
        )}

        {onDisconnect && (
          <button onClick={onDisconnect} className="font-mono text-[11px] on-card-faint underline decoration-dotted">
            sign out
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {email && <CopyChip label="email" value={email} />}
        <CopyChip label="wallet" value={address} display={`${address.slice(0, 10)}…${address.slice(-8)}`} />
      </div>
    </div>
  );
}
