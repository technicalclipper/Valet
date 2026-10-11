import type { Policy } from "../policy/types";
import { policyHash } from "../policy/canonical";
import type { OnChainCapsule } from "./reads";

export interface FieldCheck {
  field: string;
  document: string;
  chain: string;
  ok: boolean;
}

export interface Verification {
  /** both checks passed; only then does the recipient see a verified badge */
  verified: boolean;
  /** is this the document that was hashed at mint? */
  hashMatches: boolean;
  documentHash: `0x${string}`;
  chainHash: `0x${string}`;
  /** does the capsule on chain actually implement that document? */
  fields: FieldCheck[];
  failures: FieldCheck[];
}

/**
 * Two checks, answering two different questions. Both are needed, and the
 * second is the one that catches the attack worth worrying about.
 *
 * The hash comparison asks: **is this the document that was hashed at mint?**
 * It catches a document altered after the fact.
 *
 * The field comparison asks: **does the capsule on chain actually implement
 * this document?** It catches a server that showed you policy P, hashed P into
 * `policyHash`, and then minted a capsule whose bounds are not P's. The hash
 * would match perfectly; the permission would not be the one you were shown.
 * Nothing but reading the capsule's own numbers back, field by field, rules
 * that out.
 *
 * So a verified badge means: the document is intact, *and* the chain agrees
 * with every number in it. Either alone would be a weaker claim than the badge
 * appears to make.
 */
export function verifyCapsule(policy: Policy, capsule: OnChainCapsule): Verification {
  const documentHash = policyHash(policy);
  const hashMatches = documentHash.toLowerCase() === capsule.policyHash.toLowerCase();

  const b = policy.bounds;
  const c = capsule.bounds;
  const eq = (field: string, document: string, chain: string): FieldCheck => ({
    field, document, chain, ok: document.toLowerCase() === chain.toLowerCase(),
  });

  const fields: FieldCheck[] = [
    eq("perAction", b.perAction, c.perAction.toString()),
    eq("perWindow", b.perWindow, c.perWindow.toString()),
    eq("hardCap", b.hardCap, c.hardCap.toString()),
    eq("totalCap", b.totalCap, c.totalCap.toString()),
    eq("windows", String(b.windows), String(c.windows)),
    eq("windowLength", String(b.windowLength), c.windowLength.toString()),
    eq("notBefore", String(b.notBefore), c.notBefore.toString()),
    eq("expiresAt", String(b.expiresAt), c.expiresAt.toString()),
    eq("maxSlippageBps", String(b.maxSlippageBps), String(c.maxSlippageBps)),
    eq("assetOut", policy.assetOut, capsule.assetOut),
    eq("beneficiaryMode", String(policy.beneficiaryMode), String(capsule.mode)),
    eq("fixedBeneficiary", policy.fixedBeneficiary, capsule.fixedBeneficiary),
    // who it is for — the term "send the MON to bob" is actually about
    eq("recipient", policy.recipient ?? "", capsule.principal),
  ];

  const failures = fields.filter((f) => !f.ok);
  return {
    verified: hashMatches && failures.length === 0,
    hashMatches,
    documentHash,
    chainHash: capsule.policyHash,
    fields,
    failures,
  };
}

/**
 * The venue allowlist is a mapping, so it cannot be read back wholesale — each
 * address has to be asked about individually. A document naming a venue the
 * capsule does not allow is a document describing a different permission.
 */
export function verifyTargets(policy: Policy, allowed: Record<string, boolean>): FieldCheck[] {
  return policy.allowedTargets.map((t) => ({
    field: `allowedTarget[${t}]`,
    document: "allowed",
    chain: allowed[t.toLowerCase()] ? "allowed" : "not allowed",
    ok: Boolean(allowed[t.toLowerCase()]),
  }));
}

/** One line for the badge. */
export function verdictLine(v: Verification): string {
  if (v.verified) return "Verified — the chain agrees with every term shown";
  if (!v.hashMatches) return "Not verified — this document is not the one hashed at mint";
  return `Not verified — the capsule differs on ${v.failures.map((f) => f.field).join(", ")}`;
}
