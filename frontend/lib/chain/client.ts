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

export const publicClient = createPublicClient({ chain: monad, transport: http(cfg.rpcUrl) });
