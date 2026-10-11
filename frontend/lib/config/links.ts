import { addresses, chain as cfg } from "./chain";

/**
 * Every link out of Valet, in one place.
 *
 * Kuru first: the venue is the point of the trade, so every fill links to the
 * market it happened on — MON/USDC, Kuru market #00558 — where anyone can see
 * the same book the agent bought from. The explorer is MonadVision, the one
 * Kuru itself links to.
 *
 * A transaction from a local fork exists on no public explorer, so on a fork
 * `tx` and `address` return undefined and the UI shows the hash unlinked rather
 * than a link to a page that will say "not found". Kuru's market is the same
 * contract on the fork and on mainnet, so that link holds everywhere.
 */
const KURU_APP = process.env.NEXT_PUBLIC_KURU_APP_URL ?? "https://www.kuru.io";
const market = addresses.kuruMarket.toLowerCase();

export const links = {
  /** on a public explorer only when the chain is real */
  public: cfg.isMainnet,
  tx: (hash: string) => (cfg.isMainnet ? `${cfg.explorer}/tx/${hash}` : undefined),
  address: (a: string) => (cfg.isMainnet ? `${cfg.explorer}/address/${a}` : undefined),
  explorerName: "MonadVision",
  kuruMarket: `${KURU_APP}/markets/${market}`,
  kuruTrade: `${KURU_APP}/markets/${market}/trade`,
  kuruLabel: "MON/USDC on Kuru",
} as const;
