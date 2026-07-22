#!/usr/bin/env bash

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -n "${ILAL_V2_BUILD_DIR:-}" ]; then
  BUILD_DIR="$ILAL_V2_BUILD_DIR"
  mkdir -p "$BUILD_DIR"
else
  BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ilal-v2-constraints.XXXXXX")"
  trap 'rm -rf "$BUILD_DIR"' EXIT
fi
VECTOR_DIR="$BUILD_DIR/test-vectors"
WITNESS_DIR="$BUILD_DIR/witnesses"

mkdir -p "$BUILD_DIR" "$WITNESS_DIR"

echo "[1/3] Compiling isolated policy circuit v2..."
circom "$CIRCUITS_DIR/v2/ilal_policy.circom" \
  --r1cs \
  --wasm \
  --sym \
  --output "$BUILD_DIR" \
  -l "$CIRCUITS_DIR/node_modules"

echo "[2/3] Building positive and adversarial vectors..."
cd "$CIRCUITS_DIR"
npx --no-install tsx v2/build_test_vectors.ts "$VECTOR_DIR"

GENERATOR="$BUILD_DIR/ilal_policy_js/generate_witness.js"
WASM="$BUILD_DIR/ilal_policy_js/ilal_policy.wasm"

echo "[3/3] Verifying circuit constraints..."
node "$GENERATOR" "$WASM" "$VECTOR_DIR/valid.json" "$WITNESS_DIR/valid.wtns"
echo "  PASS valid eligibility witness"

for vector in low_tier wrong_country wrong_issuer_domain tampered_policy; do
  if node "$GENERATOR" "$WASM" "$VECTOR_DIR/$vector.json" "$WITNESS_DIR/$vector.wtns" >/dev/null 2>&1; then
    echo "  FAIL $vector unexpectedly satisfied the circuit" >&2
    exit 1
  fi
  echo "  PASS rejected $vector"
done

npx --no-install snarkjs r1cs info "$BUILD_DIR/ilal_policy.r1cs"
echo "Policy circuit v2 constraint tests passed."
