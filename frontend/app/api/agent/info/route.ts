import { serverAccount } from "../../../../lib/server/keys";

export const dynamic = "force-dynamic";

/** The managed agent's address, so a recipient can choose it as the holder. */
export async function GET() {
  try {
    return Response.json({ address: serverAccount("AGENT_PRIVATE_KEY").address });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
