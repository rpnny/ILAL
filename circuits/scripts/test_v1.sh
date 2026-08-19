#!/usr/bin/env bash

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ilal-v1-constraints.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT
VECTOR_DIR="$BUILD_DIR/test-vectors"
WITNESS_DIR="$BUILD_DIR/witnesses"

mkdir -p "$WITNESS_DIR"

echo "[1/3] Compiling domain-bound credential circuit..."
circom "$CIRCUITS_DIR/ilal.circom" \
  --r1cs \
  --wasm \
  --sym \
  --output "$BUILD_DIR" \
  -l "$CIRCUITS_DIR/node_modules"

echo "[2/3] Building positive and cross-domain vectors..."
cd "$CIRCUITS_DIR"
npx --no-install tsx oracle/build_v1_test_vectors.ts "$VECTOR_DIR"

GENERATOR="$BUILD_DIR/ilal_js/generate_witness.js"
WASM="$BUILD_DIR/ilal_js/ilal.wasm"

echo "[3/3] Verifying circuit constraints..."
node "$GENERATOR" "$WASM" "$VECTOR_DIR/valid.json" "$WITNESS_DIR/valid.wtns"
echo "  PASS valid domain-bound witness"

for vector in wrong_issuer_domain wrong_schema_domain legacy_version; do
  if node "$GENERATOR" "$WASM" "$VECTOR_DIR/$vector.json" "$WITNESS_DIR/$vector.wtns" >/dev/null 2>&1; then
    echo "  FAIL $vector unexpectedly satisfied the circuit" >&2
    exit 1
  fi
  echo "  PASS rejected $vector"
done

npx --no-install snarkjs r1cs info "$BUILD_DIR/ilal.r1cs"
echo "Credential circuit domain-separation tests passed."
