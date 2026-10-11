# Valet

**Give an AI agent a spending limit, not your wallet.**

Write what an agent may do in one sentence. Valet compiles it into limits on
chain and hands the agent a *capsule*: bounded, revocable authority to trade on
[Kuru](https://www.kuru.io). The agent picks when to trade. The contract
decides whether it may, with nineteen named checks. The proceeds go straight to
the person the capsule is for, in the same transaction. The agent never holds
the money, and the issuer or the recipient can stop it at any time.

> *Buy 0.1 USDC of MON daily for 5 days, never more than 0.2 USDC in one trade,
> max 1% slippage.*

## At a glance

| | |
|---|---|
| **Network** | Monad mainnet (chain 143) |
| **Valet contract** | [`0x8e77216e07cE1E4F9b5Db47621a1ef266b0d85C2`](https://monadvision.com/address/0x8e77216e07cE1E4F9b5Db47621a1ef266b0d85C2) |
| **Trading venue** | Kuru **MON/USDC**, market #00558: [`0x065C9d28E428A0db40191a54d33d5b7c71a9C394`](https://www.kuru.io/markets/0x065c9d28e428a0db40191a54d33d5b7c71a9c394/trade) |
| **Asset** | Circle USDC on Monad: [`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`](https://monadvision.com/address/0x754704Bc059F8C67012fEd69BC8A327a5aafb603) |
| **First Kuru trade** | 0.1 USDC → 0.03963 MON, straight to the recipient: [`0x1b9201…6bf6`](https://monadvision.com/tx/0x1b92017bd33e3c9c96a126a54877b5b51bc40132582f4ad137e35bea093e6bf6) |
| **Approved larger trade** | The agent asked, the issuer signed, then 0.15 USDC → 0.05942 MON on Kuru: [`0x29d498…d919`](https://monadvision.com/tx/0x29d498ed2b18c64ce1ef10a0e2f555e7498c07ecee04bc1920467150815ed919) |
| **Deployed** | block 112429973: [`0xade426…13db`](https://monadvision.com/tx/0xade426ecd3d78376648c4005b50f2881bd4b5193d45a996d54ff6ee659db13db) |
| **Built on** | [Kuru](#kuru) for every trade · [Privy](#privy) for every person's key and signature · [MCP](#the-agent) for agents we didn't write |
| **Enforced on chain** | [19 named checks](#the-nineteen-checks), all in one transaction with the trade |
| **Tests** | 106 contract tests (Kuru suites on a mainnet fork) · 84 app tests, including the MCP server end to end |

A capsule with exactly the limits above is running on Monad mainnet now.

---

## The mainnet run, step by step

Capsule #1, start to finish:

| Step | What happened | Transaction |
|---|---|---|
| Open the vault | The issuer opens a USDC vault | [`0xe5d871…b8c5`](https://monadvision.com/tx/0xe5d87137799402bd16b904830e6c8656d72c4b7d5215d8213cc6cf9239c8b8c5) |
| Fund it | 0.5 USDC goes in, the lifetime cap and no more | [`0x4f5f89…574f`](https://monadvision.com/tx/0x4f5f892cbb14355ea75cbc179d37270aba2f32ed3c60cf888b3c2c378c1d574f) |
| Mint the capsule | 0.1 USDC a day for 5 days, a hard cap of 0.2, 1% slippage, Kuru only. Minted with the hash of the policy text | [`0xc13523…7136`](https://monadvision.com/tx/0xc135232052042161eef1b46eb127d442e457d300b307d1df47968cfc0d2f7136) |
| Claim | The recipient, who holds no MON, signs and chooses the agent. The relayer pays the gas | [`0x42e2a2…f0bd`](https://monadvision.com/tx/0x42e2a2562e3c53942b657eb215b922aeb3d9fdd970466d932020c6f00c7cf0bd) |
| **Trade on Kuru** | 0.1 USDC buys 0.03963 MON, which lands with the recipient in the same transaction | [`0x1b9201…6bf6`](https://monadvision.com/tx/0x1b92017bd33e3c9c96a126a54877b5b51bc40132582f4ad137e35bea093e6bf6) |
| The agent asks for more | It requests 0.15 USDC in one go, over its per-trade cap | [`0x52213a…a584`](https://monadvision.com/tx/0x52213a5437a15235099e8e98ba78a68fabe471a90dadf20c533a1c54c6eea584) |
| The issuer approves | An EIP-712 signature from a key the agent can never hold, submitted by the relayer | [`0xd8952d…632d`](https://monadvision.com/tx/0xd8952d77946fedc4d596833eb6948f4eb7d01799df6060acfc426ea6e09a632d) |
| **Trade on Kuru, approved** | 0.15 USDC buys 0.05942 MON. The approval is used once and gone | [`0x29d498…d919`](https://monadvision.com/tx/0x29d498ed2b18c64ce1ef10a0e2f555e7498c07ecee04bc1920467150815ed919) |

Refusals don't appear here, because a refusal sends nothing. The agent asks
the contract first, by `eth_call`. A trade four times the cap is refused as
`OVER_ACTION_CAP` and a second trade in a day as `OVER_WINDOW_CAP`. An
approved request above the hard cap is refused as `OVER_HARD_CAP`, because
nothing lifts the hard cap. None of these cost anything.

---

## How one trade works

Everything below happens in one transaction. If any step fails, the whole
transaction reverts, including the Kuru fill.

```
agent ──execute(request, kuruCall)──▶ Valet
                                       │ 1. nineteen checks, then charge the caps
                                       │ 2. approve Kuru for exactly amountIn
                                       │ 3. call Kuru: placeAndExecuteMarketBuy, fill-or-kill
                                       │ 4. set the approval back to zero
                                       │ 5. measure what actually arrived (balance before vs after)
                                       │ 6. require arrived ≥ minOut, or revert as BelowFloor
                                       ▼ 7. pay the recipient, in the same transaction
                                    recipient
```

The agent chooses the moment and quotes the price from Kuru's live book. The
contract decides everything else. It doesn't trust the agent's quote: it
checks that the floor is within the capsule's slippage bound of that quote,
then measures the fill itself.

### The nineteen checks

Each one has a name, and a refusal reverts with that name: `Refused(OVER_WINDOW_CAP)`.

| Group | Checks |
|---|---|
| Who is asking | `VAULT_MISMATCH` `NOT_CLAIMED` `NOT_HOLDER` |
| Is it alive | `VAULT_REVOKED` `CAPSULE_REVOKED` `SURRENDERED` `PAUSED` `BEFORE_START` `EXPIRED` |
| Recurrence | `WINDOWS_EXHAUSTED` |
| Soft caps | `ZERO_AMOUNT` `OVER_ACTION_CAP` `OVER_WINDOW_CAP` |
| Hard caps | `OVER_HARD_CAP` `OVER_TOTAL_CAP` |
| Scope | `TARGET_NOT_ALLOWED` `SLIPPAGE_TOO_WIDE` `WRONG_RECIPIENT` |
| Funds | `VAULT_UNDERFUNDED` |

`preflight()` runs the same code as the charge, so what the UI and the agent
are told always matches what `execute()` would do. An issuer's approval lifts
the per-trade and per-window soft caps for one trade and nothing else. The hard
caps, the lifetime cap and every other check still apply.

### Who can do what

| Role | Can | Cannot |
|---|---|---|
| **Issuer**, who funds it | revoke, pause, tighten limits, top up, revoke and take the remaining money back, approve one larger trade | trade on the recipient's behalf |
| **Recipient**, who it is for | claim it and choose the agent, pause, hand it back. All by signature, so they never need gas | redirect the proceeds or touch the vault |
| **Holder**, the agent | call `execute()` | pause, revoke, redirect, approve, or withdraw anything |
| **Relayer** | submit other people's signatures and pay their gas | forge any of them: the contract checks every signature |

---

## Kuru

Valet is a consumer trading app on top of Kuru's on-chain order book:

- **Real fills, on the real book.** Every trade is `placeAndExecuteMarketBuy`
  on Kuru's MON/USDC market, with fill-or-kill set. A partial fill is refused
  outright.
- **The floor comes from Kuru's book.** The agent reads `bestBidAsk()` and
  quotes `amountIn × 10²⁸ / bestAsk`. On a fork this matched the actual fill to
  0.000% for a 5 USDC order. The floor is the quote minus the capsule's
  slippage. Kuru enforces it as `minOut`, and Valet checks it again by measuring
  the balance.
- **Only Kuru.** The market is the capsule's only allowed target, so an agent
  can't route the money anywhere else (`TARGET_NOT_ALLOWED`).
- **Every fill links back to Kuru.** The console's receipt, the history and
  "who holds what" all open the MON/USDC market on Kuru, next to the
  transaction on MonadVision.
- **One documentation note.** Kuru's docs give `placeAndExecuteMarketBuy`'s
  `minOut` as `uint96`. The deployed market expects `uint256` (selector
  `0x7c51d6cf`). Calling with the documented ABI fails with an empty revert. The
  adapter in [`contracts/src/adapters/KuruAdapter.sol`](contracts/src/adapters/KuruAdapter.sol)
  uses the deployed ABI.

## Privy

Privy holds the keys of the people the agent works for, and those keys are
the ones the agent can never reach:

- **Sign in with email or Google**, with an embedded wallet created on first
  login. Recipients never need to install a wallet.
- **Name a recipient by email alone.** Valet looks the email up with Privy's
  server API and creates a wallet for it if there isn't one, so a capsule can be
  made for someone who has never used crypto. When they sign in with that
  email, the wallet holding their claim is already theirs.
- **Everything the recipient does is a signature.** Claim, pause, resume and
  hand back are EIP-712 typed data signed in Privy and submitted by a relayer.
  The recipient pays no gas and never holds MON.
- **Approvals come from a key the agent can't hold.** Embedded-wallet keys
  can't be exported, so the issuer's EIP-712 approval of a larger trade comes
  from outside the agent's reach by construction.
- **Privy sessions authorise the costly buttons.** "Agent asks for more" sends
  a transaction the agent pays for, so the server only accepts it from the
  issuer or the recipient. It verifies their Privy access token against Privy's
  published ES256 key and maps it to the account's wallets.
- **Works with EIP-7702 wallets.** Signatures are accepted from a plain ECDSA
  key or through ERC-1271, so an account with a 7702 delegation still signs
  like the EOA it is.

## The agent

- **Valet's own agent** holds its key on the server. It can call `execute()`
  and nothing else.
- **The keeper** wakes it once in each new window, with nobody watching. It
  asks the contract first, so a paused or empty capsule costs a few reads and
  never a transaction. It leaves the window a capsule was claimed in to the
  person who claimed it.
- **The console** shows each run live, to the issuer and the recipient at once:
  wake, read the permission, quote Kuru, set the floor, the nineteen checks
  lighting up, execute, settle. Every frame is a real event from the run; the
  animation only sets the pace.
- **Bring your own agent.** [`frontend/mcp/`](frontend/mcp/README.md) is an
  MCP server for one capsule, with five tools: read the permission, quote, check,
  trade and ask. Point Claude Desktop, Claude Code or Cursor at it with the
  capsule's id and the key it was claimed to. Every limit holds the same,
  because the limits are in the contract and not in our agent. Its trades appear
  in the same console, read back from the chain.

---

## Repository

```
contracts/          Foundry
  src/Valet.sol             vaults, capsules, the nineteen checks, execute, signatures
  src/ValetTypes.sol        bounds, capsule, the Assert enum
  src/adapters/KuruAdapter  Kuru market buy/sell with the deployed ABI
  test/                     106 tests: unit, signatures, EIP-7702, and Kuru on a mainnet fork
  script/                   Deploy, SeedDemo
frontend/           Next.js 16
  app/                      landing, /create, /c/[id] (capsule + console), /me (dashboard), API routes
  lib/policy/               sentence → clauses → bounds, canonical policy hash
  lib/chain/                reads, writes, verification, event index
  lib/agent/                runtime, keeper, live event bus
  lib/server/               relayer, Privy, caller verification, per-key send queue
  mcp/                      the MCP server and its end-to-end test
dev-setup.sh        fork Monad mainnet, deploy, fund, seed a demo capsule
```

## Run it

You need [Foundry](https://getfoundry.sh) and Node 20 or later.

```bash
git clone --recursive https://github.com/technicalclipper/Valet.git
cd Valet/frontend
npm install
cp .env.example .env.local         # add your Privy app id + secret, and the two fork keys below
cd .. && ./dev-setup.sh            # anvil fork of Monad mainnet + deploy + seed
cd frontend && npm run dev         # http://localhost:3000
```

On the fork, the agent is anvil account 1 (the seeded capsule is claimed to
it) and the relayer is anvil account 3. Set `AGENT_PRIVATE_KEY` and
`RELAYER_PRIVATE_KEY` to those two published test keys, and only on the fork.
`dev-setup.sh` writes the chain values into `frontend/.env.local` and keeps
any secrets already there. The fork runs Kuru's real deployed code against a
snapshot of its real book, so trades fill the way they would on mainnet. On the
fork the console has a **+1 day** button to show the next window opening, and
the chain badge says so.

### Tests

```bash
cd contracts && forge test --fork-url https://rpc.monad.xyz   # 106 tests; the Kuru suites need the fork
cd frontend && npm test                                       # 84 tests; the live suites need dev-setup + npm run dev
```

### Mainnet

Set the `NEXT_PUBLIC_*` chain values to mainnet (see
[`frontend/.env.example`](frontend/.env.example)), give the agent and the relayer
fresh keys with a little MON each, and run one long-lived server: the live
console and the keeper run inside it. The server refuses to run with any of
anvil's published test keys on mainnet.

Monad's public RPC serves `eth_getLogs` 100 blocks at a time, so the server
keeps an index of Valet's events. It reads them in ranges the RPC accepts,
catches up from where it stopped, and caches to `frontend/data/index/`.
History, the dashboard and the keeper all read from that index.

On serverless hosts, set `KEEPER_INTERVAL_MS=0` and call `GET /api/keeper/tick`
from a cron. The live console needs a shared pub/sub in place of the in-memory
bus.
