import {
  createWalletClient,
  custom,
  erc20Abi,
  parseEventLogs,
  type Address,
  type EIP1193Provider,
} from "viem";
import { valetAbi } from "./abi";
import { publicClient, monad } from "./client";
import { addresses, chain as cfg, valetAddress } from "../config/chain";
import type { Policy } from "../policy/types";

export function walletFrom(provider: EIP1193Provider, account: Address) {
  return createWalletClient({ account, chain: monad, transport: custom(provider) });
}

export type MintStep = "approve" | "vault" | "fund" | "mint";

export interface MintProgress {
  step: MintStep | "done";
  note: string;
  hash?: `0x${string}`;
}

/** What a Privy popup is about to ask, said before it appears. */
export const MINT_STEPS: { id: MintStep; label: string; why: string }[] = [
  { id: "approve", label: "Allow Valet to move the USDC", why: "exactly the lifetime cap, and no more" },
  { id: "vault", label: "Open a vault", why: "where the money waits — the agent never holds it" },
  { id: "fund", label: "Fund the vault", why: "moves the USDC in" },
  { id: "mint", label: "Mint the permission", why: "writes the bounds on chain" },
];

/**
 * A mint that stopped partway, carrying what already exists on chain so the
 * next attempt resumes instead of starting over.
 */
export class MintInterrupted extends Error {
  constructor(
    readonly step: MintStep,
    readonly declined: boolean,
    readonly vaultId: bigint | undefined,
    cause: unknown,
  ) {
    super(
      (cause as { shortMessage?: string; message?: string })?.shortMessage ??
        (cause as Error)?.message ??
        "mint interrupted",
    );
  }
}

function isDeclined(err: unknown): boolean {
  const e = err as { code?: number; cause?: { code?: number }; name?: string; message?: string };
  return (
    e?.code === 4001 ||
    e?.cause?.code === 4001 ||
    e?.name === "UserRejectedRequestError" ||
    /user rejected|user denied|rejected the request/i.test(e?.message ?? "")
  );
}

/**
 * Mint a capsule from a compiled policy.
 *
 * Ordered so that declining costs nothing. The approval comes first: it is the
 * popup people most often refuse, because "let this app move your USDC" is
 * rightly alarming, and refusing it before a vault exists leaves no trace on
 * chain. The first version opened the vault first, so a refused approval left
 * an empty vault behind and a retry opened another.
 *
 * Each step also checks whether it has already happened — an allowance already
 * granted, a vault already open, a vault already funded — so an interrupted mint
 * resumes from where it stopped rather than repeating work or spending twice.
 *
 * Still four steps rather than one batched call. "Allow my USDC to be moved"
 * and "create a permission that spends it" are different things to agree to.
 */
export async function mintCapsule(
  provider: EIP1193Provider,
  account: Address,
  policy: Policy,
  onProgress: (p: MintProgress) => void,
  resume: { vaultId?: bigint } = {},
): Promise<{ vaultId: bigint; capsuleId: bigint }> {
  const wallet = walletFrom(provider, account);
  const valet = valetAddress();
  const usdc = policy.assetIn as Address;
  const fund = BigInt(policy.bounds.totalCap);
  let vaultId = resume.vaultId;
  let step: MintStep = "approve";

  await wallet.switchChain({ id: cfg.id }).catch(() => {});

  try {
    // --- approve, unless it is already granted
    step = "approve";
    const allowance = await publicClient.readContract({
      address: usdc, abi: erc20Abi, functionName: "allowance", args: [account, valet],
    });
    if (allowance < fund) {
      onProgress({ step, note: "Allowing Valet to move exactly the lifetime cap" });
      const h = await wallet.writeContract({ address: usdc, abi: erc20Abi, functionName: "approve", args: [valet, fund] });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // --- open a vault, unless resuming one
    step = "vault";
    if (vaultId === undefined) {
      onProgress({ step, note: "Opening a vault for the money" });
      const h = await wallet.writeContract({ address: valet, abi: valetAbi, functionName: "openVault", args: [usdc] });
      const rcpt = await publicClient.waitForTransactionReceipt({ hash: h });
      const opened = parseEventLogs({ abi: valetAbi, eventName: "VaultOpened", logs: rcpt.logs });
      vaultId = (opened[0] as unknown as { args: { vaultId: bigint } }).args.vaultId;
    }

    // --- fund only the shortfall, so a resumed mint never pays twice
    step = "fund";
    const vault = (await publicClient.readContract({
      address: valet, abi: valetAbi, functionName: "getVault", args: [vaultId],
    })) as unknown as { balance: bigint };
    if (vault.balance < fund) {
      onProgress({ step, note: "Funding the vault" });
      const h = await wallet.writeContract({
        address: valet, abi: valetAbi, functionName: "fundVault", args: [vaultId, fund - vault.balance],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }

    // --- mint
    step = "mint";
    onProgress({ step, note: "Minting the permission" });
    const mintHash = await wallet.writeContract({
      address: valet,
      abi: valetAbi,
      functionName: "mintCapsule",
      args: [
        {
          vaultId,
          principal: policy.beneficiaryMode === 2 ? (policy.fixedBeneficiary as Address) : account,
          mode: policy.beneficiaryMode,
          fixedBeneficiary: policy.fixedBeneficiary as Address,
          assetOut: policy.assetOut as Address,
          policyHash: policy.policyHash as `0x${string}`,
          bounds: {
            perAction: BigInt(policy.bounds.perAction),
            perWindow: BigInt(policy.bounds.perWindow),
            hardCap: BigInt(policy.bounds.hardCap),
            totalCap: BigInt(policy.bounds.totalCap),
            windows: policy.bounds.windows,
            windowLength: BigInt(policy.bounds.windowLength),
            notBefore: BigInt(policy.bounds.notBefore),
            expiresAt: BigInt(policy.bounds.expiresAt),
            maxSlippageBps: policy.bounds.maxSlippageBps,
          },
          allowedTargets: policy.allowedTargets as Address[],
        },
      ],
    });
    const mintRcpt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
    const minted = parseEventLogs({ abi: valetAbi, eventName: "CapsuleMinted", logs: mintRcpt.logs });
    const capsuleId = (minted[0] as unknown as { args: { capsuleId: bigint } }).args.capsuleId;

    onProgress({ step: "done", note: "Minted", hash: mintHash });
    return { vaultId, capsuleId };
  } catch (err) {
    throw new MintInterrupted(step, isDeclined(err), vaultId, err);
  }
}

/** The chain's own clock. On a fork it can be days ahead of the wall clock. */
export async function chainNow(): Promise<number> {
  const block = await publicClient.getBlock();
  return Number(block.timestamp);
}

export async function usdcBalance(account: Address): Promise<bigint> {
  return publicClient.readContract({
    address: addresses.usdc, abi: erc20Abi, functionName: "balanceOf", args: [account],
  });
}

export async function nativeBalance(account: Address): Promise<bigint> {
  return publicClient.getBalance({ address: account });
}

/**
 * Top up a wallet on a local fork, using anvil's cheat codes.
 *
 * Only possible against a fork — the RPC simply rejects these methods anywhere
 * real — so there is no way for this to quietly work in production. Without it
 * a fresh Privy wallet on a local chain has no USDC and no MON, and the create
 * flow cannot be exercised at all.
 */
export async function devFund(account: Address): Promise<boolean> {
  if (cfg.isMainnet) return false;
  const body = (method: string, params: unknown[]) =>
    fetch(cfg.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then((r) => r.json());

  try {
    await body("anvil_setBalance", [account, "0x56BC75E2D63100000"]); // 100 MON
    // USDC _balances is slot 9 on the Monad USDC proxy; see contracts/README.md
    const { keccak256, encodeAbiParameters } = await import("viem");
    const slot = keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [account, 9n],
      ),
    );
    await body("anvil_setStorageAt", [
      addresses.usdc,
      slot,
      "0x0000000000000000000000000000000000000000000000000000000ba43b7400", // 50,000 USDC
    ]);
    return true;
  } catch {
    return false;
  }
}
