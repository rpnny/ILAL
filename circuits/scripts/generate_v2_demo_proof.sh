#!/usr/bin/env bash

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build-v2"
WALLET="${1:-${ILAL_V2_WALLET:-}}"
OUTPUT_DIR="${2:-$CIRCUITS_DIR/../artifacts/v2-demo/${WALLET:-missing-wallet}}"

if ! [[ "$WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Usage: bash scripts/generate_v2_demo_proof.sh <wallet> [output-dir]" >&2
  exit 1
fi

for file in \
  "$BUILD_DIR/ilal_policy_js/generate_witness.js" \
  "$BUILD_DIR/ilal_policy_js/ilal_policy.wasm" \
  "$BUILD_DIR/ilal_policy_v2.zkey" \
  "$BUILD_DIR/ilal_policy_v2_vkey.json"; do
  if [ ! -s "$file" ]; then
    echo "ERROR: missing v2 proving artifact: $file" >&2
    echo "Run ILAL_UNSAFE_DEV_CEREMONY=1 bash scripts/compile_v2.sh for Base Sepolia only." >&2
    exit 1
  fi
done

mkdir -p "$OUTPUT_DIR"
ILAL_V2_WALLET="$WALLET" npx --no-install tsx \
  "$CIRCUITS_DIR/v2/build_test_vectors.ts" "$OUTPUT_DIR/vectors"

node "$BUILD_DIR/ilal_policy_js/generate_witness.js" \
  "$BUILD_DIR/ilal_policy_js/ilal_policy.wasm" \
  "$OUTPUT_DIR/vectors/valid.json" \
  "$OUTPUT_DIR/witness.wtns"

npx --no-install snarkjs groth16 prove \
  "$BUILD_DIR/ilal_policy_v2.zkey" \
  "$OUTPUT_DIR/witness.wtns" \
  "$OUTPUT_DIR/proof.json" \
  "$OUTPUT_DIR/public.json"

npx --no-install snarkjs groth16 verify \
  "$BUILD_DIR/ilal_policy_v2_vkey.json" \
  "$OUTPUT_DIR/public.json" \
  "$OUTPUT_DIR/proof.json"

cp "$BUILD_DIR/SHA256SUMS" "$OUTPUT_DIR/proving-artifact-SHA256SUMS"

echo
echo "V2 demo proof generated and verified."
echo "Wallet: $WALLET"
echo "Proof:  $OUTPUT_DIR/proof.json"
echo "Public: $OUTPUT_DIR/public.json"
echo "Input containing private attributes remains local under:"
echo "        $OUTPUT_DIR/vectors/valid.json"
