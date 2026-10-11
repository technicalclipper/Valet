import { tick } from "../../../../../lib/agent/keeper";
import { advanceTime } from "../../../../../lib/agent/runtime";

export const dynamic = "force-dynamic";

/**
 * Fork only: jump a day forward so the next window can be shown now.
 *
 * Then nudge the keeper rather than wait for its next tick, so the demo shows
 * what a real day turning over looks like — the window opens and the agent
 * trades on its own, with nobody pressing anything.
 */
export async function POST(_req: Request, ctx: RouteContext<"/api/agent/[id]/advance">) {
  await ctx.params;
  const ok = await advanceTime(86_400);
  if (ok) void tick().catch(() => {});
  return Response.json({ ok }, { status: ok ? 200 : 403 });
}
