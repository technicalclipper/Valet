import { relay } from "../../../../lib/server/relayer";
import { runOnce } from "../../../../lib/agent/runtime";

export const dynamic = "force-dynamic";
const uint = /^\d+$/, sig = /^0x[0-9a-fA-F]{130}$/;

/**
 * The issuer signed an Escalation; submit it, then let the agent spend under it
 * so both consoles watch the approval turn into a trade — or, when the amount is
 * over the hard cap, watch the chain refuse a spend the issuer just approved.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  if (!uint.test(b.capsuleId ?? "") || !uint.test(b.amount ?? "") || !uint.test(b.nonce ?? "") ||
      !uint.test(b.deadline ?? "") || !sig.test(b.signature ?? ""))
    return Response.json({ ok: false, error: "malformed request" }, { status: 400 });
  const r = await relay("approveEscalation", [
    BigInt(b.capsuleId), BigInt(b.amount), BigInt(b.nonce), BigInt(b.deadline), b.signature,
  ]);
  if (r.ok) void runOnce(b.capsuleId, { amountIn: BigInt(b.amount), elevatedNonce: BigInt(b.nonce) });
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
