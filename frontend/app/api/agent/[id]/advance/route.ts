import { advanceTime } from "../../../../../lib/agent/runtime";

export const dynamic = "force-dynamic";

/** Fork only: jump a day forward so the next window can be shown now. */
export async function POST(_req: Request, ctx: RouteContext<"/api/agent/[id]/advance">) {
  await ctx.params;
  const ok = await advanceTime(86_400);
  return Response.json({ ok }, { status: ok ? 200 : 403 });
}
