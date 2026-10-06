#!/usr/bin/env bash
# regenerate frontend/lib/chain/abi.ts from the Foundry artifact
set -euo pipefail
cd "$(dirname "$0")"
PATH="$HOME/.foundry/bin:$PATH" forge build --root contracts >/dev/null
python3 - <<'PY'
import json, pathlib
art = json.load(open('contracts/out/Valet.sol/Valet.json'))
keep = {'getCapsule','getVault','headroom','preflight','preflightElevated','beneficiaryOf',
        'getEscalation','allowedTarget','proceedsOf','escalationNonce','escalationDigest',
        'ESCALATION_TYPEHASH','nextCapsuleId','nextVaultId',
        'openVault','fundVault','mintCapsule','claim','execute','executeElevated',
        'requestEscalation','approveEscalation','revoke','surrender','tighten',
        'revokeVaultAndSweep','revokeVault','sweepProceeds',
        'setPausedByIssuer','setPausedByPrincipal'}
events = {'Executed','CapsuleMinted','CapsuleClaimed','CapsuleRevoked','CapsuleSurrendered',
          'CapsulePaused','CapsuleTightened','VaultOpened','VaultFunded','VaultRevoked',
          'VaultSwept','ProceedsSwept','EscalationRequested','EscalationApproved','EscalationConsumed'}
out = [e for e in art['abi'] if
       (e.get('type')=='function' and e.get('name') in keep) or
       (e.get('type')=='event' and e.get('name') in events) or
       e.get('type')=='error']
hdr = ('// Generated from contracts/out/Valet.sol/Valet.json — do not edit by hand.\n'
       '// Regenerate with `npm run abi` after changing the contract, so the frontend\n'
       '// cannot drift from what is deployed.\n\n'
       'export const valetAbi = ')
pathlib.Path('frontend/lib/chain/abi.ts').write_text(hdr + json.dumps(out, indent=2) + ' as const;\n')
print("regenerated frontend/lib/chain/abi.ts")
PY
