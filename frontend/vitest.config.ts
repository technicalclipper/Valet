import { defineConfig, loadEnv } from "vite";

/**
 * Load .env.local the way Next does.
 *
 * The live read tests talk to whatever Valet dev-setup.sh last deployed, and
 * that address changes on every anvil restart. Without this they fell back to a
 * hardcoded address and failed against a contract that was no longer there —
 * which looked like four broken tests rather than one stale constant.
 */
export default defineConfig(({ mode }) => ({
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, process.cwd(), "")).map(([k, v]) => [
      `process.env.${k}`,
      JSON.stringify(v),
    ]),
  ),
  test: {
    include: ["lib/**/*.test.ts", "mcp/**/*.test.ts"],
    // The live suites share one chain. Run in parallel, one file's openVault
    // landed between another's before-and-after reads of nextVaultId and failed
    // a correct test. Seven files run fine one after another.
    fileParallelism: false,
  },
}));
