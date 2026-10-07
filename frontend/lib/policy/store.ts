import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Policy } from "./types";

/**
 * Where a capsule's policy document lives.
 *
 * A file per capsule, which is honest about what this is: the document has to
 * be served from somewhere so a recipient can hash it and compare, and for now
 * that somewhere is the repo. The verification is not weakened by this — the
 * whole point of hashing the served document against the chain is that the
 * server is not trusted. A real deployment swaps this for a database without
 * changing what the badge proves.
 */
export async function loadPolicy(capsuleId: bigint | string): Promise<Policy | null> {
  const file = path.join(process.cwd(), "data", "policies", `${capsuleId}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as Policy;
  } catch {
    return null;
  }
}
