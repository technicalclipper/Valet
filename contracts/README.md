# Valet — contracts

Bounded, revocable spending authority for agents. A capsule is the permission,
a vault holds the money, and nineteen checks stand between an agent and a spend.

```
src/Valet.sol                  the capability layer
src/ValetTypes.sol             bounds, roles, the Assert enum, escalations
src/adapters/KuruAdapter.sol   venue calldata, in one place
src/interfaces/IKuruOrderBook.sol
```

## Running the tests

```bash
forge test                                        # 51 tests, no network
forge test --fork-url https://rpc.monad.xyz       # 92 tests, incl. real Kuru
```

Fork-dependent suites skip themselves when `chainid != 143`, so the first
command is not a lie — it runs everything that does not need a live book.

Note `vm.createSelectFork` **cannot** fork Monad on forge 1.8.1 (it fails with
*"cannot create a `monad` fork with an EVM instantiated for `ethereum`"*, and
neither `--chain monad` nor `--chain 143` helps). The fork has to come from
`--fork-url` on the command line.

## The development loop

Monad **testnet is not a target**. Kuru is not deployed there — the documented
market, aggregator and USDC addresses all return empty code on 10143 — so every
trade would be a mock and the one thing worth demonstrating would be the one
thing untested. Develop against a local fork of mainnet instead, which gives
real Kuru, real depth and real prices at no cost.

```bash
# 1. a local Monad mainnet, forked
anvil --fork-url https://rpc.monad.xyz --port 8545

# 2. deploy
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # anvil #0
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 \
  --private-key $PK --broadcast

# 3. give yourself USDC. _balances lives at slot 9 of the USDC proxy
SLOT=$(cast index address 0xf39Fd6e51aad88F6F4ce6aB8827279cfffb92266 9)
cast rpc anvil_setStorageAt 0x754704Bc059F8C67012fEd69BC8A327a5aafb603 $SLOT \
  0x0000000000000000000000000000000000000000000000000000000ba43b7400 \
  --rpc-url http://localhost:8545

# 4. seed the demo's opening state
VALET=<address> AGENT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
forge script script/SeedDemo.s.sol --rpc-url http://localhost:8545 \
  --private-key $PK --broadcast
```

That leaves vault 1 funded with 100 USDC and capsule 1 minted for *"5 USDC of
MON daily for 30 days, max 1% slippage"*, claimed by anvil account #1.

## The two beats, verified against a deployed contract

```
execute  5 USDC  ->  status 1, 1.741917502700000000 MON to bob, 450k gas
execute 20 USDC  ->  Refused(12)  [OVER_ACTION_CAP], nothing moved
```

`preflight(request, caller)` returns the same judgement as a view, which is what
the console reads to show which checks pass before anything is attempted. It
shares its body with the charge, so the UI cannot promise what the chain refuses.

## Notes that cost time to learn

**The Kuru ABI in the docs is wrong.** `docs.kuru.io` gives
`placeAndExecuteMarketBuy(uint96,uint96,bool,bool)`; the deployed market is
`(uint96,uint256,bool,bool)` — selector `0x7c51d6cf`, not `0xb4b1d7cd`. The
documented types miss the dispatcher and revert with **empty returndata in ~900
gas**, which reads exactly like a sizing bug. Confirmed against the live node:
the real signature reverts `TransferFromFailed()` for an unfunded caller, the
documented one returns `0x`.

**Kuru buys pay native MON**, not an ERC20 — base asset is `address(0)`. Proceeds
are measured on `address(this).balance`.

**Only immediate-settlement orders are expressible.** A resting GTC order fills
in a later transaction and so cannot satisfy the guarantee that proceeds reach
the beneficiary in the same transaction as the trade. `KuruAdapter` has no
helper for one on purpose.
