import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { monad } from "../chain/client";
import { types, domain, type ValetPrimaryType } from "./typedData";

/**
 * Sign one of Valet's typed messages with the person's own wallet.
 *
 * Goes through viem rather than a raw eth_signTypedData_v4, because the React
 * SDK takes viem's shape — camelCase primaryType — and viem builds the
 * EIP712Domain from the domain object itself, so it cannot drift from the four
 * fields OpenZeppelin's EIP712 hashes (name, version, chainId,
 * verifyingContract). The REST path wants snake_case instead; see
 * toPrivyRestTypedData.
 */
export async function signValet(
  provider: EIP1193Provider,
  account: Address,
  verifyingContract: Address,
  primaryType: ValetPrimaryType,
  message: Record<string, unknown>,
): Promise<`0x${string}`> {
  const wallet = createWalletClient({ account, chain: monad, transport: custom(provider) });
  return wallet.signTypedData({
    account,
    domain: domain(monad.id, verifyingContract),
    types,
    primaryType,
    message: message as never,
  });
}
