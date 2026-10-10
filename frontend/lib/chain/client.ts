import { createPublicClient, defineChain, http } from "viem";
import { chain as cfg } from "../config/chain";

/** Monad, parameterised by env so one build serves fork, mainnet and testnet. */
export const monad = defineChain({
  id: cfg.id,
  name: cfg.label,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [cfg.rpcUrl] } },
  blockExplorers: { default: { name: "Monad Explorer", url: cfg.explorer } },
});

/**
 * Timeout and retries set explicitly. viem's defaults are 10 seconds and three
 * retries per call, and a page makes several calls — with the RPC down, a
 * capsule page hung for over forty seconds before the error page could appear.
 * Failing in seconds and saying why beats a spinner nobody waits out.
 */
export const publicClient = createPublicClient({
  chain: monad,
  transport: http(cfg.rpcUrl, { timeout: 6_000, retryCount: 1 }),
});
