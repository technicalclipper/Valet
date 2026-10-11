import { getAddress, recoverMessageAddress, type Address } from "viem";
import { readCapsule } from "../chain/reads";
import { walletsOfUser } from "./privy";

/**
 * Who is calling, for the few routes that spend the agent's gas on someone's
 * say-so.
 *
 * Two ways to prove it. In the app, a Privy access token: verified here against
 * Privy's published key, then turned into the wallets on that account. Outside
 * the app — the tests, the MCP server, a script — a signature over a short
 * message naming the action, the capsule and the time, which needs nothing but
 * a key. Either way the answer is a set of addresses, and the route decides
 * whether any of them is a party to the capsule.
 */
const PRIVY_ISSUER = "privy.io";
const SKEW = 300; // seconds a signed message stays good, either side of now

type Jwk = JsonWebKey & { kid?: string };
const g = globalThis as unknown as { __valetJwks?: { at: number; keys: Jwk[] } };

async function privyKeys(appId: string): Promise<Jwk[]> {
  if (g.__valetJwks && Date.now() - g.__valetJwks.at < 3_600_000) return g.__valetJwks.keys;
  const r = await fetch(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Could not fetch Privy's signing keys (${r.status}).`);
  const keys = ((await r.json()) as { keys: Jwk[] }).keys;
  g.__valetJwks = { at: Date.now(), keys };
  return keys;
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** An ES256 JWT, checked by hand: the signature, the issuer, the audience, the expiry. */
export async function privyUserId(token: string): Promise<string | null> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return null;
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  const header = JSON.parse(b64url(h).toString()) as { alg?: string; kid?: string };
  if (header.alg !== "ES256") return null;
  const jwk = (await privyKeys(appId)).find((k) => !header.kid || k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, b64url(sig), new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;
  const claims = JSON.parse(b64url(p).toString()) as { iss?: string; aud?: string | string[]; exp?: number; sub?: string };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== PRIVY_ISSUER || !aud.includes(appId)) return null;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
  return claims.sub ?? null;
}

/** The message a key signs to act outside the app. Kept in one place so both sides agree. */
export function callerMessage(action: string, capsuleId: string, at: number): string {
  return `Valet: ${action} capsule ${capsuleId} at ${at}`;
}

export async function callerAddresses(req: Request, action: string, capsuleId: string): Promise<Address[]> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const user = await privyUserId(auth.slice(7)).catch(() => null);
    if (user) return (await walletsOfUser(user)).map((a) => getAddress(a));
  }
  const sig = req.headers.get("x-valet-signature");
  const at = Number(req.headers.get("x-valet-at"));
  if (sig && Number.isFinite(at) && Math.abs(Date.now() / 1000 - at) <= SKEW) {
    const who = await recoverMessageAddress({
      message: callerMessage(action, capsuleId, at), signature: sig as `0x${string}`,
    }).catch(() => null);
    if (who) return [who];
  }
  return [];
}

/** The issuer or the recipient of this capsule, or neither. */
export async function partyOf(capsuleId: string, callers: Address[]): Promise<"issuer" | "recipient" | null> {
  if (!callers.length) return null;
  const c = await readCapsule(BigInt(capsuleId));
  const set = new Set(callers.map((a) => a.toLowerCase()));
  if (set.has(c.issuer.toLowerCase())) return "issuer";
  if (set.has(c.principal.toLowerCase())) return "recipient";
  return null;
}
