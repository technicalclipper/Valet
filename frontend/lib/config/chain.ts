/**
 * Every address and endpoint comes from the environment, so moving between a
 * local fork, Monad mainnet and a hosted fork is a deploy-time config change
 * rather than a code change. Nothing here is hardcoded on purpose: the app is
 * going to run in at least three places before the deadline.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. See .env.example.`);
  return value;
}

export const chain = {
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 143),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "http://localhost:8545",
  /** shown in the header, so a demo video can never pass a fork off as mainnet */
  label: process.env.NEXT_PUBLIC_CHAIN_LABEL ?? "local fork",
  isMainnet: (process.env.NEXT_PUBLIC_CHAIN_LABEL ?? "") === "Monad mainnet",
  explorer: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://monadvision.com",
  /**
   * Block the Valet contract was deployed at. Log queries start here rather
   * than at 0: on a fork, anything before the fork point has to be fetched from
   * upstream, which is slow at best and an error at worst — and on mainnet,
   * scanning from genesis is pointless when the contract did not exist.
   */
  deployBlock: BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0"),
} as const;

export const addresses = {
  valet: process.env.NEXT_PUBLIC_VALET_ADDRESS as `0x${string}` | undefined,
  kuruMarket: (process.env.NEXT_PUBLIC_KURU_MARKET ??
    "0x065C9d28E428A0db40191a54d33d5b7c71a9C394") as `0x${string}`,
  usdc: (process.env.NEXT_PUBLIC_USDC ??
    "0x754704Bc059F8C67012fEd69BC8A327a5aafb603") as `0x${string}`,
} as const;

export function valetAddress(): `0x${string}` {
  return required("NEXT_PUBLIC_VALET_ADDRESS", addresses.valet) as `0x${string}`;
}
