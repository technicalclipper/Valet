import { runOnce } from "../../../../../lib/agent/runtime";

export const dynamic = "force-dynamic";

/**
 * Wake the agent once.
 *
 * Open to anyone, deliberately, and safe because of what it is: the agent can
 * only do what the capsule allows. A second press inside a spent window is
 * refused at preflight and sends no transaction. An inflated `amountIn` is
 * refused by the contract by name. The endpoint inherits the guarantees rather
 * than needing its own.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agent/[id]/run">) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad capsule id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { amountIn?: string };
  const amountIn = body.amountIn && /^\d+$/.test(body.amountIn) ? BigInt(body.amountIn) : undefined;

  const result = await runOnce(id, { amountIn });
  return Response.json(result, { status: result.started ? 200 : 409 });
}
