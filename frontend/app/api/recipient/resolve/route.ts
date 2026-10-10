import { walletForEmail } from "../../../../lib/server/privy";

export const dynamic = "force-dynamic";
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/** An email in, the address of that person's Privy wallet out. */
export async function POST(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email || !EMAIL.test(email)) return Response.json({ error: "That is not an email address." }, { status: 400 });
  try {
    return Response.json(await walletForEmail(email.trim().toLowerCase()));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
