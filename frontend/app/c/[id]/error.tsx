"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * The page could not read the chain.
 *
 * Said carefully: the capsule is not gone, and nothing happened to the money —
 * this page simply failed to ask. The commonest cause in development is the
 * local fork having stopped. Next 16 passes `retry`, not the older `reset`.
 */
export default function CapsuleError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid-field min-h-[70vh]">
      <div className="mx-auto max-w-xl px-6 py-24">
        <section className="card-pop p-6" style={{ ["--pop" as string]: "#d8366f" }}>
          <p className="eyebrow">couldn&apos;t reach the chain</p>
          <h1 className="mt-1 text-2xl font-semibold on-card">This page can&apos;t read the capsule right now</h1>
          <p className="mt-2 text-[14px] on-card-dim">
            The capsule is still there and nothing has happened to its money — this page just failed to
            ask the chain about it. The RPC may be busy or down. Trying again usually works.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={retry} className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: "#16161a" }}>
              Try again
            </button>
            <Link href="/" className="rounded-full border-2 px-4 py-2 text-sm font-semibold on-card" style={{ borderColor: "rgb(22 22 26 / 0.2)" }}>
              Home
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
