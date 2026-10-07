import { keccak256, toHex } from "viem";

/**
 * Deterministic serialisation. Object keys are sorted at every depth so the
 * hash is a function of the policy's content and not of whichever serialiser
 * happened to run — the browser that mints and the browser that later verifies
 * are not the same code path, and they have to agree to the byte.
 *
 * Arrays keep their order: the order of `allowedTargets` and of `clauses` is
 * part of what was agreed, not an accident of iteration.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/**
 * The value written to `capsule.policyHash` at mint.
 *
 * The verification badge a recipient sees is this hash, recomputed in their
 * browser from the document they were served, compared against the capsule on
 * chain. It answers a narrow question precisely: is our own server telling the
 * truth about the chain?
 */
export function policyHash(policy: unknown): `0x${string}` {
  return keccak256(toHex(canonicalize(policy)));
}

/**
 * A policy carrying its own hash.
 *
 * The hash has to be computed over the document *without* the hash field, or
 * it would be hashing itself. Keeping that in one function means no caller has
 * to remember it — a mistake that would surface only as an unverifiable capsule
 * long after minting.
 */
export function withHash<T extends object>(policy: T): T & { policyHash: `0x${string}` } {
  const { policyHash: _ignored, ...rest } = policy as T & { policyHash?: string };
  return { ...(policy as T), policyHash: policyHash(rest) };
}
