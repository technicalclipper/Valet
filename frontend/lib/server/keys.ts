import { privateKeyToAccount } from "viem/accounts";
import { chain as cfg } from "../config/chain";

/**
 * Anvil's default accounts. Their private keys are printed by every anvil and
 * Hardhat node on earth, and on Monad mainnet they show hundreds of
 * transactions from strangers and empty balances — bots sweep them within
 * seconds of being funded. Fine on a fork; a guaranteed loss anywhere real.
 */
const ANVIL_PUBLIC_KEYS = new Set([
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
  "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
  "0x976ea74026e726554db657fa54763abd0c3a0aa9",
  "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
  "0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f",
  "0xa0ee7a142d267c1f36714e4a8f75612f20a79720",
]);

/**
 * A server-side key, by environment variable name, refused on mainnet if it is
 * one of anvil's. Shared by the agent and the relayer, so the guard cannot be
 * forgotten on the second one.
 */
export function serverAccount(envName: "AGENT_PRIVATE_KEY" | "RELAYER_PRIVATE_KEY") {
  const pk = process.env[envName];
  if (!pk) throw new Error(`${envName} is not set. See .env.example.`);
  const account = privateKeyToAccount(pk as `0x${string}`);
  if (cfg.isMainnet && ANVIL_PUBLIC_KEYS.has(account.address.toLowerCase())) {
    throw new Error(
      `Refusing to act on mainnet with ${account.address} (${envName}): it is one of anvil's ` +
        "published test keys, which sweeper bots drain the moment they are funded. Use a fresh key.",
    );
  }
  return account;
}
