import { relay } from "../../../../lib/server/relayer";

export const dynamic = "force-dynamic";
const uint = /^\d+$/, sig = /^0x[0-9a-fA-F]{130}$/;

/** The recipient signed a pause, resume, or hand-back; submit it. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = Number(b.action);
  if (!uint.test(String(b.capsuleId ?? "")) || ![0, 1].includes(action) || typeof b.value !== "boolean" ||
      !uint.test(String(b.deadline ?? "")) || !sig.test(String(b.signature ?? "")))
    return Response.json({ ok: false, error: "malformed request" }, { status: 400 });
  const r = await relay("principalActionBySignature", [
    BigInt(String(b.capsuleId)), action, b.value, BigInt(String(b.deadline)), b.signature,
  ]);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
