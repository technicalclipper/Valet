# Valet MCP server

Hand one capsule to an agent Valet did not write: Claude Desktop, Claude Code,
Cursor, or anything else that speaks MCP. The agent gets five tools and its own
key. The contract enforces every limit, so this server has no guarantees of its
own to keep.

| tool | what it does | costs gas |
|---|---|---|
| `valet_capsule` | the permission in plain words: caps, windows, recipient, what is left, any pending request for more | no |
| `valet_quote` | what an amount of USDC buys on Kuru's live book, and the floor the capsule would set | no |
| `valet_check` | asks the contract whether a trade would pass all nineteen checks, and names the one that would refuse it | no |
| `valet_trade` | the trade: Kuru fill, slippage floor, proceeds to the recipient, in one transaction | yes |
| `valet_ask` | asks the issuer to approve one trade above the per-action cap. Nothing lifts the hard cap | yes |

No tool can pause, revoke, redirect, or touch the vault. The key behind these
tools is only the holder's, and the contract gives the holder nothing more.

## Connect it

1. Make a key for the agent and note its address.
2. On the capsule page, the recipient claims it to that address: **Another
   agent or key**.
3. Fund the key with a little MON for gas.
4. Add the server.

Claude Code:

```bash
claude mcp add valet -e VALET_CAPSULE=4 -e VALET_AGENT_KEY=0x… -- /path/to/Valet/frontend/node_modules/.bin/tsx /path/to/Valet/frontend/mcp/server.ts
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "valet": {
      "command": "/path/to/Valet/frontend/node_modules/.bin/tsx",
      "args": ["/path/to/Valet/frontend/mcp/server.ts"],
      "env": { "VALET_CAPSULE": "4", "VALET_AGENT_KEY": "0x…" }
    }
  }
}
```

Run `npm install` in `frontend/` first. The command is the repo's own `tsx`,
by absolute path, because MCP clients start servers from their own working
directory, and `npx --prefix` does not resolve from there.

The chain settings are read from `frontend/.env.local` when it exists, which
is right for a local fork. To point the server anywhere else, set
`VALET_RPC_URL`, `VALET_ADDRESS`, `VALET_CHAIN_ID`, `VALET_CHAIN_LABEL` and
`VALET_DEPLOY_BLOCK`. Only the public chain settings are read from that file.
It also holds the managed agent's key, and an outside agent never picks that up.

On mainnet the server refuses anvil's published test keys, the same as the
app does.

## Watching it

Both people can still watch it. The keeper reads every `Executed` event from a
holder that isn't Valet's own agent and replays it into that capsule's console.
They see the outside agent trade the same way they see ours, read back from
the chain.

## Tests

`npm test` includes `mcp/server.test.ts`. It spawns this server over stdio with
a key that has no other role in the app, and drives it with a real MCP client:
read, quote, check, trade, refused second trade, ask, and the trade appearing in
the console.
