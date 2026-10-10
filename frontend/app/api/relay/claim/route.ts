import { relay } from "../../../../lib/server/relayer";

export const dynamic = "force-dynamic";
const uint = /^\d+$/, addr = /^0x[0-9a-fA-F]{40}$/, sig = /^0x[0-9a-fA-F]{130}$/;

/** The recipient (or issuer) signed a Claim; submit it. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!uint.test(b.capsuleId ?? "") || !addr.test(b.holder ?? "") || !uint.test(b.deadline ?? "") || !sig.test(b.signature ?? ""))
    return Response.json({ ok: false, error: "malformed request" }, { status: 400 });
  const r = await relay("claimBySignature", [BigInt(b.capsuleId), b.holder, BigInt(b.deadline), b.signature]);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
