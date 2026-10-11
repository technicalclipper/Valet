/** Start the keeper with the server — Node only, never on the edge runtime. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startKeeper } = await import("./lib/agent/keeper");
    startKeeper();
  }
}
