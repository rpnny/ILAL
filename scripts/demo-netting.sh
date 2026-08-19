#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: scripts/demo-netting.sh <token0-order.json> <token1-order.json> [global signer options]" >&2
  echo "Example signer options: --keystore solver.json --password-file solver.password" >&2
  exit 2
fi

ORDER0=$1
ORDER1=$2
shift 2

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLI="$REPO_DIR/cli/dist/index.js"

npm --prefix "$REPO_DIR/cli" run build >/dev/null

echo "ILAL Hookathon atomic netting preview"
node "$CLI" netting batch preview --orders "$ORDER0" "$ORDER1"

echo
echo "Broadcasting permissionless atomic batch"
node "$CLI" "$@" netting batch execute --orders "$ORDER0" "$ORDER1"
