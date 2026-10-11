import { beforeAll, describe, expect, it } from "vitest";
import { privyUserId } from "./caller";

/**
 * The Privy access token is checked by hand, so it is tested by hand: a key of
 * our own stands in for Privy's, and each way a token can be wrong is refused.
 */
const APP = "test-app";
let priv: CryptoKey;
let other: CryptoKey;

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
async function jwt(claims: Record<string, unknown>, key = priv, alg = "ES256") {
  const head = enc({ alg, kid: "k1", typ: "JWT" });
  const body = enc(claims);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${Buffer.from(sig).toString("base64url")}`;
}
const good = () => ({ iss: "privy.io", aud: APP, sub: "did:privy:abc", exp: Math.floor(Date.now() / 1000) + 600 });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_PRIVY_APP_ID = APP;
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  priv = pair.privateKey;
  other = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])).privateKey;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
  (globalThis as unknown as { __valetJwks: unknown }).__valetJwks = { at: Date.now(), keys: [jwk] };
});

describe("privy access tokens", () => {
  it("accepts a token signed by the app's key", async () => {
    expect(await privyUserId(await jwt(good()))).toBe("did:privy:abc");
  });
  it("refuses a token signed by any other key", async () => {
    expect(await privyUserId(await jwt(good(), other))).toBeNull();
  });
  it("refuses another app's token", async () => {
    expect(await privyUserId(await jwt({ ...good(), aud: "someone-else" }))).toBeNull();
  });
  it("refuses a token not issued by privy", async () => {
    expect(await privyUserId(await jwt({ ...good(), iss: "evil.example" }))).toBeNull();
  });
  it("refuses an expired token", async () => {
    expect(await privyUserId(await jwt({ ...good(), exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
  });
  it("refuses a token claiming no algorithm", async () => {
    const [, body] = (await jwt(good())).split(".");
    expect(await privyUserId(`${enc({ alg: "none" })}.${body}.`)).toBeNull();
  });
  it("refuses a token whose claims were edited after signing", async () => {
    const [head, , sig] = (await jwt(good())).split(".");
    expect(await privyUserId(`${head}.${enc({ ...good(), sub: "did:privy:someone" })}.${sig}`)).toBeNull();
  });
});
