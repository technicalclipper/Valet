import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Configuration for the MCP server, set before any Valet module loads — they
 * read the chain from the environment when imported.
 *
 * Chain settings come from VALET_* variables, falling back to the app's own
 * .env.local so a local fork needs nothing but a capsule and a key. Only the
 * public chain settings are taken from that file: it also holds the managed
 * agent's key, and an outside agent must never quietly become that one.
 */
const here = dirname(fileURLToPath(import.meta.url));

function appEnv(): Record<string, string> {
  const file = process.env.VALET_ENV_FILE ?? join(here, "..", ".env.local");
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function configure(): { capsuleId: string } {
  const file = appEnv();
  const pick = (valet: string, next: string) => {
    const v = process.env[valet] ?? process.env[next] ?? file[next];
    if (v !== undefined) process.env[next] = v;
  };
  pick("VALET_RPC_URL", "NEXT_PUBLIC_RPC_URL");
  pick("VALET_ADDRESS", "NEXT_PUBLIC_VALET_ADDRESS");
  pick("VALET_CHAIN_ID", "NEXT_PUBLIC_CHAIN_ID");
  pick("VALET_CHAIN_LABEL", "NEXT_PUBLIC_CHAIN_LABEL");
  pick("VALET_DEPLOY_BLOCK", "NEXT_PUBLIC_DEPLOY_BLOCK");
  pick("VALET_EXPLORER_URL", "NEXT_PUBLIC_EXPLORER_URL");

  const capsuleId = process.env.VALET_CAPSULE ?? "";
  if (!/^\d+$/.test(capsuleId)) throw new Error("Set VALET_CAPSULE to the capsule this agent holds.");
  const key = process.env.VALET_AGENT_KEY;
  if (!key) throw new Error("Set VALET_AGENT_KEY to the private key of the address the capsule was claimed to.");
  // the runtime signs as AGENT_PRIVATE_KEY, with the mainnet guard against anvil's keys
  process.env.AGENT_PRIVATE_KEY = key;
  return { capsuleId };
}
