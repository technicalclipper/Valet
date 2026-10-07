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

export interface MintProgress {
  step: "vault" | "approve" | "fund" | "mint" | "done";
  note: string;
  hash?: `0x${string}`;
}

/**
 * Mint a capsule from a compiled policy.
 *
 * Four transactions rather than one. They could be batched behind a helper
 * contract, and for a product they probably should be — but each step here is a
 * thing the issuer is actually agreeing to, and collapsing "approve my USDC"
 * into the same click as "create a permission" is how people end up having
 * agreed to something they did not read.
 */
export async function mintCapsule(
  provider: EIP1193Provider,
  account: Address,
  policy: Policy,
  onProgress: (p: MintProgress) => void,
): Promise<{ vaultId: bigint; capsuleId: bigint }> {
  const wallet = walletFrom(provider, account);
  const valet = valetAddress();
  const fund = BigInt(policy.bounds.totalCap);

  await wallet.switchChain({ id: cfg.id }).catch(() => {});

  onProgress({ step: "vault", note: "Opening a vault for the money" });
  const openHash = await wallet.writeContract({
    address: valet, abi: valetAbi, functionName: "openVault", args: [policy.assetIn as Address],
  });
  const openRcpt = await publicClient.waitForTransactionReceipt({ hash: openHash });
  const opened = parseEventLogs({ abi: valetAbi, eventName: "VaultOpened", logs: openRcpt.logs });
  const vaultId = (opened[0] as unknown as { args: { vaultId: bigint } }).args.vaultId;

  onProgress({ step: "approve", note: "Allowing Valet to move that much USDC, and no more", hash: openHash });
  const approveHash = await wallet.writeContract({
    address: policy.assetIn as Address, abi: erc20Abi, functionName: "approve", args: [valet, fund],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  onProgress({ step: "fund", note: "Funding the vault", hash: approveHash });
  const fundHash = await wallet.writeContract({
    address: valet, abi: valetAbi, functionName: "fundVault", args: [vaultId, fund],
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });

  onProgress({ step: "mint", note: "Minting the permission", hash: fundHash });
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
