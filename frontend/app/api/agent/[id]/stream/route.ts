import { lastRun, subscribe } from "../../../../../lib/agent/bus";
import type { AgentEvent } from "../../../../../lib/agent/types";

export const dynamic = "force-dynamic";

/**
 * Server-sent events for one capsule.
 *
 * Issuer and recipient both open this. A late joiner first receives the last
 * run in full, so opening the page mid-run or just after it shows what the
 * agent did rather than an empty console, then live events as they happen.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/agent/[id]/stream">) {
  const { id } = await ctx.params;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      for (const e of lastRun(id)) send(e);
      const off = subscribe(id, send);
      const beat = setInterval(() => controller.enqueue(enc.encode(`: beat\n\n`)), 15_000);
      req.signal.addEventListener("abort", () => {
        off();
        clearInterval(beat);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
