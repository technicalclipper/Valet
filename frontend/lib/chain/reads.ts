import type { Address } from "viem";
import { valetAbi } from "./abi";
import { publicClient } from "./client";
import { valetAddress } from "../config/chain";

/** Mirrors the Assert enum in ValetTypes.sol, in order. Index is the on-chain value. */
export const ASSERTS = [
  "NONE",
  "VAULT_MISMATCH", "NOT_CLAIMED", "NOT_HOLDER",
  "VAULT_REVOKED", "CAPSULE_REVOKED", "SURRENDERED", "PAUSED", "BEFORE_START", "EXPIRED",
  "WINDOWS_EXHAUSTED",
  "ZERO_AMOUNT", "OVER_ACTION_CAP", "OVER_WINDOW_CAP",
  "OVER_HARD_CAP", "OVER_TOTAL_CAP",
  "TARGET_NOT_ALLOWED", "SLIPPAGE_TOO_WIDE", "WRONG_RECIPIENT",
  "VAULT_UNDERFUNDED",
] as const;

export type AssertName = (typeof ASSERTS)[number];

/** The groups the console draws, matching how the contract reasons. */
export const ASSERT_GROUPS: { label: string; members: AssertName[] }[] = [
  { label: "who is asking", members: ["VAULT_MISMATCH", "NOT_CLAIMED", "NOT_HOLDER"] },
  { label: "is it alive", members: ["VAULT_REVOKED", "CAPSULE_REVOKED", "SURRENDERED", "PAUSED", "BEFORE_START", "EXPIRED"] },
  { label: "recurrence", members: ["WINDOWS_EXHAUSTED"] },
  { label: "soft caps", members: ["ZERO_AMOUNT", "OVER_ACTION_CAP", "OVER_WINDOW_CAP"] },
  { label: "hard caps", members: ["OVER_HARD_CAP", "OVER_TOTAL_CAP"] },
  { label: "scope", members: ["TARGET_NOT_ALLOWED", "SLIPPAGE_TOO_WIDE", "WRONG_RECIPIENT"] },
  { label: "funds", members: ["VAULT_UNDERFUNDED"] },
];

export interface OnChainBounds {
  perAction: bigint; perWindow: bigint; hardCap: bigint; totalCap: bigint;
  windows: number; windowLength: bigint; notBefore: bigint; expiresAt: bigint;
  maxSlippageBps: number;
}

export interface OnChainCapsule {
  vaultId: bigint;
  issuer: Address;
  principal: Address;
  holder: Address;
  mode: number;
  fixedBeneficiary: Address;
  assetOut: Address;
  policyHash: `0x${string}`;
  bounds: OnChainBounds;
  spentTotal: bigint;
  spentInWindow: bigint;
  lastWindowIndex: number;
  revoked: boolean;
  surrendered: boolean;
  pausedByIssuer: boolean;
  pausedByPrincipal: boolean;
}

export interface SpendRequest {
  capsuleId: bigint; vaultId: bigint; amountIn: bigint;
  quotedOut: bigint; minOut: bigint; target: Address; recipient: Address;
}

const base = () => ({ address: valetAddress(), abi: valetAbi } as const);

export async function readCapsule(capsuleId: bigint): Promise<OnChainCapsule> {
  const c = (await publicClient.readContract({
    ...base(), functionName: "getCapsule", args: [capsuleId],
  })) as unknown as OnChainCapsule;
  return c;
}

export async function readVault(vaultId: bigint) {
  return (await publicClient.readContract({
    ...base(), functionName: "getVault", args: [vaultId],
  })) as unknown as { asset: Address; issuer: Address; balance: bigint; revoked: boolean };
}

export async function readHeadroom(capsuleId: bigint) {
  const [perActionLeft, windowLeft, totalLeft, windowIndex] = (await publicClient.readContract({
    ...base(), functionName: "headroom", args: [capsuleId],
  })) as [bigint, bigint, bigint, bigint];
  return { perActionLeft, windowLeft, totalLeft, windowIndex };
}

/**
 * What the console shows before anything is attempted.
 *
 * This is the contract's own judgement, not a reimplementation of it: preflight
 * shares its body with the charge inside Valet.sol, so the lights the UI draws
 * cannot promise something the chain would refuse.
 */
export async function preflight(r: SpendRequest, caller: Address, elevated = false): Promise<AssertName> {
  const v = (await publicClient.readContract({
    ...base(),
    functionName: elevated ? "preflightElevated" : "preflight",
    args: [r, caller],
  })) as number;
  return ASSERTS[v] ?? "NONE";
}

export async function readBeneficiary(capsuleId: bigint): Promise<Address> {
  return (await publicClient.readContract({
    ...base(), functionName: "beneficiaryOf", args: [capsuleId],
  })) as Address;
}

export async function readAllowedTarget(capsuleId: bigint, target: Address): Promise<boolean> {
  return (await publicClient.readContract({
    ...base(), functionName: "allowedTarget", args: [capsuleId, target],
  })) as boolean;
}

export async function readEscalation(capsuleId: bigint, nonce: bigint) {
  return (await publicClient.readContract({
    ...base(), functionName: "getEscalation", args: [capsuleId, nonce],
  })) as unknown as {
    requestedAmount: bigint; approvedAmount: bigint; deadline: bigint;
    requested: boolean; approved: boolean; consumed: boolean;
  };
}
