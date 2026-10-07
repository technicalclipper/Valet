import type { Address, Hex } from "viem";

/**
 * The three things a person signs, as EIP-712 typed data.
 *
 * Shapes come from Valet.sol's typehashes. The names and field order must match
 * exactly or the digest differs and the contract rejects a signature that looks
 * perfectly valid — so these are written against the constants
 * (ESCALATION_TYPEHASH, CLAIM_TYPEHASH, PRINCIPAL_ACTION_TYPEHASH) rather than
 * from memory, and the contract exposes a digest view to check against.
 */
export function domain(chainId: number, verifyingContract: Address) {
  return { name: "Valet", version: "1", chainId, verifyingContract } as const;
}

export const types = {
  Escalation: [
    { name: "capsuleId", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  Claim: [
    { name: "capsuleId", type: "uint256" },
    { name: "holder", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
  PrincipalAction: [
    { name: "capsuleId", type: "uint256" },
    { name: "action", type: "uint8" },
    { name: "value", type: "bool" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export type ValetPrimaryType = keyof typeof types;

export interface TypedDataPayload {
  domain: ReturnType<typeof domain>;
  types: typeof types;
  primaryType: ValetPrimaryType;
  message: Record<string, unknown>;
}

export function buildTypedData(
  chainId: number,
  verifyingContract: Address,
  primaryType: ValetPrimaryType,
  message: Record<string, unknown>,
): TypedDataPayload {
  return { domain: domain(chainId, verifyingContract), types, primaryType, message };
}

/**
 * Privy's REST endpoint and Privy's React SDK disagree about one key, and the
 * error it produces does not say so.
 *
 * The client SDK takes viem's shape, with `primaryType` in camelCase. The
 * server endpoint (POST /v1/wallets/{id}/rpc, eth_signTypedData_v4) wants
 * `primary_type` in snake_case, and passing camelCase there returns a 400
 * `invalid_data` that reads like a schema problem rather than a naming one.
 * Everything else — domain, types, message — passes through unchanged.
 *
 * Use this only on the server path. The browser path wants the payload as-is.
 */
export function toPrivyRestTypedData(p: TypedDataPayload) {
  const { primaryType, ...rest } = p;
  return { ...rest, primary_type: primaryType };
}

export interface SignedAction {
  signature: Hex;
  nonce: bigint;
  deadline: bigint;
}
