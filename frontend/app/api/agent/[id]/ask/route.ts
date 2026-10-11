import { requestMore } from "../../../../../lib/agent/runtime";
import { callerAddresses, partyOf } from "../../../../../lib/server/caller";

export const dynamic = "force-dynamic";

/**
 * Have the agent ask the issuer for more than its per-action cap.
 *
 * Only the issuer or the recipient may press this. Unlike waking the agent, an
 * ask is always a transaction — requestEscalation, paid for by the agent — and
 * nothing in the contract limits how often it can be asked. Left open, a
 * stranger could spend the agent's gas one question at a time.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agent/[id]/ask">) {
  const { id } = await ctx.params;
  const b = (await req.json().catch(() => ({}))) as { amount?: string; reason?: string };
  if (!/^\d+$/.test(id) || !/^\d+$/.test(b.amount ?? ""))
    return Response.json({ ok: false, error: "malformed request" }, { status: 400 });

  const callers = await callerAddresses(req, "ask", id);
  if (!callers.length)
    return Response.json({ ok: false, reason: "Sign in as the issuer or the recipient to have the agent ask." }, { status: 401 });
  if (!(await partyOf(id, callers).catch(() => null)))
    return Response.json({ ok: false, reason: "Only the issuer or the recipient can have the agent ask." }, { status: 403 });

  const reason = (b.reason ?? "").slice(0, 140) || "the book is unusually deep today";
  const r = await requestMore(id, BigInt(b.amount!), reason);
  return Response.json(r, { status: r.ok ? 200 : 422 });
}
