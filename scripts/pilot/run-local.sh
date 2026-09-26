#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if curl --silent --max-time 1 http://127.0.0.1:8548 >/dev/null; then
  echo 'Port 8548 is already in use. Stop that process before running the isolated issuer pilot.' >&2
  exit 1
fi
mkdir -p artifacts/pilot
anvil --port 8548 --chain-id 31337 --silent >artifacts/pilot/anvil.log 2>&1 &
ILAL_PILOT_ANVIL_PID=$!
trap 'kill "$ILAL_PILOT_ANVIL_PID" 2>/dev/null || true' EXIT
for i in $(seq 1 50); do
  if curl --silent --max-time 1 http://127.0.0.1:8548 >/dev/null; then break; fi
  sleep 0.1
done
node scripts/pilot/local-pilot.mjs http://127.0.0.1:8548
