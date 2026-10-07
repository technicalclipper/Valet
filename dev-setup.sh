#!/usr/bin/env bash
# One command to get a working local environment.
#
# Starts an anvil fork of Monad mainnet, deploys Valet, funds an account with
# USDC, seeds the demo capsule, and writes the chain values into
# frontend/.env.local — leaving any secrets already in that file alone.
#
# anvil forgets everything when it stops, so this is the thing to run after a
# reboot, and the reason the chain values are written rather than memorised.
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$PATH"

RPC=http://localhost:8545
# anvil's first account. A published test key — never use it anywhere real.
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cfffb92266
AGENT=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
USDC=0x754704Bc059F8C67012fEd69BC8A327a5aafb603
USDC_BALANCES_SLOT=9   # found by sweeping candidate slots; see contracts/README.md

if ! cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  echo "starting anvil (fork of Monad mainnet)..."
  nohup anvil --fork-url https://rpc.monad.xyz --port 8545 --silent > /tmp/anvil.log 2>&1 &
  for _ in $(seq 1 30); do cast chain-id --rpc-url $RPC >/dev/null 2>&1 && break; sleep 1; done
fi
CHAIN=$(cast chain-id --rpc-url $RPC)
[ "$CHAIN" = "143" ] || { echo "expected chain 143, got $CHAIN"; exit 1; }
echo "anvil up, chain $CHAIN, block $(cast block-number --rpc-url $RPC)"

echo "deploying Valet..."
DEPLOY_BLOCK=$(cast block-number --rpc-url $RPC)
VALET=$(forge script contracts/script/Deploy.s.sol --root contracts \
  --rpc-url $RPC --private-key $PK --broadcast 2>/dev/null \
  | grep -oE 'Valet +0x[0-9a-fA-F]{40}' | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
[ -n "$VALET" ] || { echo "deploy failed"; exit 1; }
echo "  Valet $VALET (block $DEPLOY_BLOCK)"

echo "funding $DEPLOYER with 50,000 USDC..."
SLOT=$(cast index address $DEPLOYER $USDC_BALANCES_SLOT)
cast rpc anvil_setStorageAt $USDC "$SLOT" \
  0x0000000000000000000000000000000000000000000000000000000ba43b7400 --rpc-url $RPC >/dev/null

echo "compiling the demo policy..."
# Compile first, so the capsule is minted with the hash of the document the app
# will serve. notBefore has to agree too, since it is part of the hashed policy.
# cast wraps --json output in a {success, data, ...} envelope
NOW=$(cast block latest --json --rpc-url $RPC | python3 -c 'import json,sys;print(int(json.load(sys.stdin)["data"]["timestamp"],16))')
POLICY=$(cd frontend && NOT_BEFORE=$NOW CAPSULE_ID=1 npx vite-node scripts/emit-policy.ts 2>/dev/null | tail -1)
POLICY_HASH=$(echo "$POLICY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["hash"])')
NOT_BEFORE=$(echo "$POLICY" | python3 -c 'import json,sys;print(json.load(sys.stdin)["notBefore"])')
echo "  policyHash $POLICY_HASH (notBefore $NOT_BEFORE)"
echo "  document   frontend/data/policies/1.json"

echo "seeding the demo capsule..."
VALET=$VALET AGENT=$AGENT POLICY_HASH=$POLICY_HASH NOT_BEFORE=$NOT_BEFORE \
forge script contracts/script/SeedDemo.s.sol --root contracts \
  --rpc-url $RPC --private-key $PK --broadcast 2>/dev/null \
  | grep -E 'vaultId|capsuleId|holder' || true

ENVFILE=frontend/.env.local
[ -f "$ENVFILE" ] || { echo "no $ENVFILE — copy frontend/.env.example first"; exit 1; }
python3 - "$ENVFILE" "$VALET" "$DEPLOY_BLOCK" <<'PY'
import re, sys
path, valet, block = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
for key, val in (("NEXT_PUBLIC_VALET_ADDRESS", valet), ("NEXT_PUBLIC_DEPLOY_BLOCK", block)):
    if re.search(rf"^{key}=.*$", s, re.M):
        s = re.sub(rf"^{key}=.*$", f"{key}={val}", s, flags=re.M)
    else:
        s += f"\n{key}={val}\n"
open(path, "w").write(s)
print(f"  wrote {path}: VALET={valet} DEPLOY_BLOCK={block}")
PY
echo
echo "ready. npm --prefix frontend run dev"
