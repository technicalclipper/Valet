/**
 * Compiles the demo sentence and writes the policy document plus its hash.
 *
 * dev-setup.sh runs this before seeding so the capsule is minted with the hash
 * of the document the app will actually serve — otherwise the verification
 * badge reports "not verified" on our own demo, which would be an accurate
 * report of a broken setup rather than a working one.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { compile } from "../lib/policy/compile";
import { extractWithRules } from "../lib/policy/extract";
import { policyHash } from "../lib/policy/canonical";

const SENTENCE =
  process.env.POLICY_SENTENCE ??
  "Buy 5 USDC of MON daily for 30 days, max 1% slippage, send the MON to bob";
const notBefore = Number(process.env.NOT_BEFORE ?? Math.floor(Date.now() / 1000));
const capsuleId = process.env.CAPSULE_ID ?? "1";

// SeedDemo's principal; the seeded capsule's document has to name it to verify
const recipient = process.env.PRINCIPAL ?? "0x0000000000000000000000000000000000000B0b";
const result = compile(SENTENCE, await extractWithRules(SENTENCE), notBefore, { recipient });
if (!result.ok || !result.policy) {
  console.error("compile failed:", result.blockers.join(" "));
  process.exit(1);
}

mkdirSync("data/policies", { recursive: true });
writeFileSync(`data/policies/${capsuleId}.json`, JSON.stringify(result.policy, null, 2));

// consumed by dev-setup.sh
console.log(
  JSON.stringify({
    hash: policyHash(result.policy),
    notBefore: result.policy.bounds.notBefore,
    expiresAt: result.policy.bounds.expiresAt,
  }),
);
