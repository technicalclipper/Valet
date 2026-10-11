import { readFile } from "node:fs/promises";
import path from "node:path";
import { compile } from "./compile";
import { extractWithRules } from "./extract";
import type { Policy } from "./types";

/**
 * Where a capsule's policy document comes from.
 *
 * Preferably nowhere. The compiler is deterministic, and the capsule already
 * stores `notBefore` on chain, so a link carrying the original sentence is
 * enough to rebuild the document byte for byte — which means no database, and
 * a deployment with a read-only filesystem is not a problem to solve.
 *
 * It also makes the verification stronger rather than weaker. A document
 * reconstructed from the sentence and the chain's own timestamp was not served
 * by anyone, so "did the server hand me the real terms" stops being a question
 * that needs asking.
 *
 * The file store remains for the seeded demo capsule and as a fallback for
 * anything an LLM extractor produced, where the output is not reproducible from
 * the input alone.
 */
export async function loadPolicy(
  capsuleId: bigint | string,
  fromLink?: { sentence?: string; notBefore?: number; recipient?: string },
): Promise<Policy | null> {
  if (fromLink?.sentence && fromLink.notBefore !== undefined) {
    const sentence = fromLink.sentence;
    // The recipient comes from the link, not the chain: reading it from the
    // capsule would compare the chain with itself and prove nothing.
    const result = compile(sentence, await extractWithRules(sentence), fromLink.notBefore, {
      recipient: fromLink.recipient,
    });
    if (result.ok && result.policy) return result.policy;
    return null;
  }

  const file = path.join(process.cwd(), "data", "policies", `${capsuleId}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8")) as Policy;
  } catch {
    return null;
  }
}

/** Pack a sentence into a link. Base64url so it survives a QR code cleanly. */
export function encodeSentence(sentence: string): string {
  return Buffer.from(sentence, "utf8").toString("base64url");
}

export function decodeSentence(encoded: string): string | null {
  try {
    const s = Buffer.from(encoded, "base64url").toString("utf8");
    // a sentence long enough to have compiled, short enough to be a sentence
    return s.length > 8 && s.length < 600 ? s : null;
  } catch {
    return null;
  }
}
