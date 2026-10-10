import Link from "next/link";
import { Header } from "../../components/Header";

/** A link to a capsule that does not exist — mistyped, or from another deployment. */
export default function CapsuleNotFound() {
  return (
    <>
      <Header />
      <main className="grid-field min-h-[70vh]">
        <div className="mx-auto max-w-xl px-6 py-24">
          <section className="card-pop p-6" style={{ ["--pop" as string]: "#7e65d4" }}>
            <p className="eyebrow">no such capsule</p>
            <h1 className="mt-1 text-2xl font-semibold on-card">There&apos;s nothing at this link</h1>
            <p className="mt-2 text-[14px] on-card-dim">
              No capsule has this number on the chain this page is reading. The link may be mistyped, or
              it may point at a capsule on a different network — a local fork and mainnet have separate
              capsules.
            </p>
            <div className="mt-4 flex gap-2">
              <Link href="/create" className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ background: "#16161a" }}>
                Write a permission
              </Link>
              <Link href="/" className="rounded-full border-2 px-4 py-2 text-sm font-semibold on-card" style={{ borderColor: "rgb(22 22 26 / 0.2)" }}>
                Home
              </Link>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
