/**
 * Turning an email into a wallet, before its owner has signed in.
 *
 * Privy can create a user for an email and pregenerate their embedded wallet,
 * so a capsule can name someone as its recipient by email alone — "set it up for
 * Mum" without asking Mum for an address she does not have yet. When she signs
 * in by email, the wallet holding her claim is already hers.
 *
 * Looks the email up first and only creates on a miss, so naming the same
 * person twice reuses one wallet rather than making two.
 *
 * One thing this cannot promise: whether signing in with Google later lands on
 * the same user as an email-created one is Privy's account-linking decision. The
 * redeem page therefore tells an emailed recipient to sign in by email.
 */
const BASE = "https://auth.privy.io/api/v1";

export function headers() {
  const id = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const secret = process.env.PRIVY_APP_SECRET;
  if (!id || !secret) throw new Error("Privy is not configured on the server.");
  return {
    authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    "privy-app-id": id,
    "content-type": "application/json",
  };
}

interface PrivyAccount { type?: string; address?: string; chain_type?: string; wallet_client_type?: string }
interface PrivyUser { id?: string; linked_accounts?: PrivyAccount[]; wallets?: PrivyAccount[] }

function walletOf(u: PrivyUser): string | undefined {
  const all = [...(u.linked_accounts ?? []), ...(u.wallets ?? [])];
  return all.find(
    (a) => a.type === "wallet" && (a.chain_type ?? "ethereum") === "ethereum" &&
      (a.wallet_client_type ?? "privy") === "privy" && a.address,
  )?.address;
}

export async function walletForEmail(email: string): Promise<{ address: string; created: boolean }> {
  const h = headers();
  const found = await fetch(`${BASE}/users/email/address`, {
    method: "POST", headers: h, body: JSON.stringify({ address: email }),
  });
  if (found.ok) {
    const addr = walletOf((await found.json()) as PrivyUser);
    if (addr) return { address: addr, created: false };
    throw new Error("That person has a Privy account without a wallet yet. Ask them to sign in once.");
  }
  if (found.status !== 404) throw new Error(`Privy lookup failed (${found.status}).`);

  const made = await fetch(`${BASE}/users`, {
    method: "POST", headers: h,
    body: JSON.stringify({ linked_accounts: [{ type: "email", address: email }], wallets: [{ chainType: "ethereum" }] }),
  });
  if (!made.ok) throw new Error(`Privy could not create a wallet for that email (${made.status}).`);
  const addr = walletOf((await made.json()) as PrivyUser);
  if (!addr) throw new Error("Privy created the user but returned no wallet address.");
  return { address: addr, created: true };
}

/**
 * Every Ethereum wallet linked to a Privy user — embedded or external — so a
 * person who signed in with MetaMask is recognised as well as one using the
 * wallet Privy made.
 */
export async function walletsOfUser(userId: string): Promise<string[]> {
  const r = await fetch(`${BASE}/users/${encodeURIComponent(userId)}`, { headers: headers() });
  if (!r.ok) throw new Error(`Privy user lookup failed (${r.status}).`);
  const u = (await r.json()) as PrivyUser;
  const all = [...(u.linked_accounts ?? []), ...(u.wallets ?? [])];
  return all
    .filter((a) => a.type === "wallet" && (a.chain_type ?? "ethereum") === "ethereum" && a.address)
    .map((a) => a.address!.toLowerCase());
}
