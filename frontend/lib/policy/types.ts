/**
 * A clause is one thing the user asked for. Every clause lands in exactly one
 * of three buckets, and the recipient is shown all three before anything mints.
 *
 *  enforced  the chain checks it. One of the nineteen asserts, or a field the
 *            capsule stores. If the agent ignores it, the transaction reverts.
 *  advisory  the agent is told, and nothing makes it obey. Strategy, timing,
 *            preference — things no contract can verify.
 *  refused   we will not pretend to support it. Either the architecture cannot
 *            express it, or honouring it would undo the point of the product.
 */
export type Verdict = "enforced" | "advisory" | "refused";

export interface Clause {
  /** the user's own words, so they can see themselves in the output */
  text: string;
  verdict: Verdict;
  /** which capsule field or assert carries it, when enforced */
  boundTo?: string;
  /** why, in a sentence the recipient can read */
  because: string;
}

/** What the LLM is allowed to return: structure, never verdicts. */
export interface ExtractedPolicy {
  amountPerAction?: { value: number; asset: string };
  cadence?: { every: number; unit: "hour" | "day" | "week" | "month" };
  periods?: number;
  buyAsset?: string;
  maxSlippagePercent?: number;
  hardCeiling?: { value: number; asset: string };
  beneficiary?: { kind: "principal" | "vault" | "fixed"; label?: string };
  venues?: string[];
  startAt?: string;
  /** anything the extractor could not map to a field above */
  unmapped?: string[];
}

/** The document that gets hashed, published, and checked against the chain. */
export interface Policy {
  version: 1;
  source: string;
  clauses: Clause[];
  bounds: {
    perAction: string;
    perWindow: string;
    hardCap: string;
    totalCap: string;
    windows: number;
    windowLength: number;
    notBefore: number;
    expiresAt: number;
    maxSlippageBps: number;
  };
  assetIn: string;
  assetOut: string;
  beneficiaryMode: 0 | 1 | 2;
  fixedBeneficiary: string;
  allowedTargets: string[];
  /** passed to the agent as instructions; never enforced */
  advisory: string[];
}

export interface CompileResult {
  ok: boolean;
  policy?: Policy;
  clauses: Clause[];
  /** present when a refused clause makes the whole policy unmintable */
  blockers: string[];
}
