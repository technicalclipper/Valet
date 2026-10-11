import { runOnce } from "../../../../../lib/agent/runtime";
import { readCapsule } from "../../../../../lib/chain/reads";
import { callerAddresses, partyOf } from "../../../../../lib/server/caller";

export const dynamic = "force-dynamic";

/**
 * Wake the agent once.
 *
 * Open to anyone, deliberately, and safe because of what it is: the agent can
 * only do what the capsule allows. A second press inside a spent window is
 * refused at preflight and sends no transaction. An inflated `amountIn` is
 * refused by the contract by name, also without a transaction.
 *
 * The one thing the contract does not stop is a run *smaller* than the
 * per-action cap: the window cap would allow a thousand trades of a thousandth
 * each, and every one would be a real transaction on the agent's gas. So a
 * stranger gets the per-action amount or more, and only the issuer or the
 * recipient can choose less.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/agent/[id]/run">) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad capsule id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { amountIn?: string };
  const amountIn = body.amountIn && /^\d+$/.test(body.amountIn) ? BigInt(body.amountIn) : undefined;

  if (amountIn !== undefined) {
    const c = await readCapsule(BigInt(id)).catch(() => null);
    if (c && amountIn < c.bounds.perAction && !(await partyOf(id, await callerAddresses(req, "run", id)).catch(() => null)))
      return Response.json(
        { started: false, reason: "Only the issuer or the recipient can run a trade smaller than the per-action cap." },
        { status: 403 },
      );
  }

  const result = await runOnce(id, { amountIn });
  return Response.json(result, { status: result.started ? 200 : 409 });
}
