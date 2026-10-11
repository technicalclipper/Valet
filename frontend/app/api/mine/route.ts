import { isAddress } from "viem";
import { findMine } from "../../../lib/chain/mine";
import { toJson } from "../../../lib/json";

export const dynamic = "force-dynamic";

/**
 * Every capsule an address issued or receives. Public on purpose: it is a view
 * of public chain events, the same list anyone could rebuild from the logs.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!isAddress(address, { strict: false })) return Response.json({ error: "bad address" }, { status: 400 });
  try {
    return new Response(toJson(await findMine(address)), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
