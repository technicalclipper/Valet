import { requestMore } from "../../../../../lib/agent/runtime";

export const dynamic = "force-dynamic";

/** Have the agent ask the issuer for more than its per-action cap. */
export async function POST(req: Request, ctx: RouteContext<"/api/agent/[id]/ask">) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { amount?: string; reason?: string };
  if (!/^\d+$/.test(id) || !/^\d+$/.test(b.amount ?? ""))
    return Response.json({ ok: false, error: "malformed request" }, { status: 400 });
  const reason = (b.reason ?? "").slice(0, 140) || "the book is unusually deep today";
  const r = await requestMore(id, BigInt(b.amount!), reason);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
