"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { CopyChip } from "./CopyChip";
import { nativeBalance, usdcBalance } from "../../lib/chain/writes";
import { amount } from "../../lib/format";

/**
 * The signed-in account, in the header where people look for it.
 *
 * It had its own card on the compose page, which put "which account is this"
 * above "what am I writing" — the wrong order, and it only existed on one page.
 * As a header chip it is available everywhere and in the way nowhere.
 *
 * The chip itself shows only the address and whether the wallet can pay. The
 * email, the full address and sign-out live behind a click, because those are
 * things you go looking for rather than things you need in view.
 */
export function AccountChip() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<{ usdc: bigint; mon: bigint } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const wallet = wallets[0];
  const address = wallet?.address as Address | undefined;
  const email = user?.google?.email ?? user?.email?.address;

  useEffect(() => {
    if (!address) return;
    let live = true;
    void Promise.all([usdcBalance(address), nativeBalance(address)])
      .then(([usdc, mon]) => live && setBalances({ usdc, mon }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [address, open]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!ready) return <span className="font-mono text-[11px] text-text-faint">·</span>;

  if (!authenticated || !address) {
    return (
      <button
        onClick={login}
        className="rounded-full border border-white/15 px-3 py-1 font-mono text-[11px] text-text-dim transition hover:border-white/30 hover:text-text"
      >
        sign in
      </button>
    );
  }

  const broke = balances?.usdc === 0n;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 transition hover:border-white/30"
      >
        <span className="breathe h-1.5 w-1.5 rounded-full" style={{ background: "var(--enforced)" }} />
        <span className="font-mono text-[11px] text-text-dim">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        {balances && (
          <span
            className="font-mono text-[11px]"
            style={{ color: broke ? "var(--refused)" : "var(--text-faint)" }}
          >
            {amount(balances.usdc, 6, "")}
          </span>
        )}
      </button>

      {open && (
        <div
          className="card-pop card-enter absolute right-0 top-[calc(100%+10px)] z-50 w-[min(21rem,calc(100vw-2rem))] p-4"
          style={{ ["--pop" as string]: "#7e65d4" }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold on-card">Signed in</span>
            <button
              onClick={() => {
                setOpen(false);
                void logout();
              }}
              className="font-mono text-[11px] on-card-faint underline decoration-dotted"
            >
              sign out
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {email && <CopyChip label="email" value={email} />}
            <CopyChip
              label="wallet"
              value={address}
              display={`${address.slice(0, 10)}…${address.slice(-8)}`}
            />
          </div>

          {balances && (
            <dl className="mt-3 flex items-baseline gap-5 font-mono text-[12px]">
              <div>
                <dt className="eyebrow">usdc</dt>
                <dd style={{ color: broke ? "#d8366f" : "#16161a" }}>{amount(balances.usdc)}</dd>
              </div>
              <div>
                <dt className="eyebrow">gas</dt>
                <dd className="on-card-dim">{amount(balances.mon, 18, "MON")}</dd>
              </div>
            </dl>
          )}

          {broke && (
            <p className="mt-2 text-[12px]" style={{ color: "#d8366f" }}>
              This wallet cannot fund a capsule yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
