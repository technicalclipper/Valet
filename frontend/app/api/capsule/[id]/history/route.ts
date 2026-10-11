import { readHistory } from "../../../../../lib/chain/events";
import { toJson } from "../../../../../lib/json";

export const dynamic = "force-dynamic";

/** A capsule's events, from the server's index of the chain's logs. */
export async function GET(_req: Request, ctx: RouteContext<"/api/capsule/[id]/history">) {
  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "bad capsule id" }, { status: 400 });
  try {
    return new Response(toJson(await readHistory(BigInt(id))), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
