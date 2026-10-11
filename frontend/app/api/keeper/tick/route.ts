import { tick } from "../../../../lib/agent/keeper";

export const dynamic = "force-dynamic";

/**
 * One keeper pass, on demand — for a cron on serverless hosts, where the
 * in-process timer cannot live. Guarded by CRON_SECRET when one is set (Vercel
 * cron sends it as a bearer token). Harmless even unguarded: a tick only starts
 * runs the contract would allow, once per window.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    return Response.json(await tick());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
