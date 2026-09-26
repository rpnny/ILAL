#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Refuse to take over an existing listener; this process owns only its ephemeral chain.
if curl --silent --max-time 1 http://127.0.0.1:8547 >/dev/null; then
  echo 'Port 8547 is already in use. Stop your own local instance before running this isolated gate.' >&2
  exit 1
fi
mkdir -p artifacts/mixed
anvil --port 8547 --chain-id 31337 --silent >artifacts/mixed/anvil.log 2>&1 &
ILAL_MIXED_ANVIL_PID=$!
trap 'kill "$ILAL_MIXED_ANVIL_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 50); do
  if curl --silent --max-time 1 http://127.0.0.1:8547 >/dev/null; then break; fi
  sleep 0.1
done
# The economics baseline deploys Uniswap's test routers directly. Foundry does
# not emit dependency test artifacts during the normal contracts build.
forge build --root contracts \
  lib/v4-core/src/test/PoolSwapTest.sol \
  lib/v4-core/src/test/PoolModifyLiquidityTest.sol
node scripts/mixed/local-deploy.mjs
node scripts/mixed/local-e2e.mjs
node scripts/mixed/economics.mjs
node scripts/mixed/console-e2e.mjs
