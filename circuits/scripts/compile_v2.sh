#!/usr/bin/env bash

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ILAL_V2_BUILD_DIR:-$CIRCUITS_DIR/build-v2}"
PTAU_FILE="${ILAL_V2_PTAU_FILE:-$CIRCUITS_DIR/ptau/pot18_final.ptau}"
CONTRACT_OUT="${ILAL_V2_VERIFIER_OUT:-$CIRCUITS_DIR/../contracts/src/verifier/ILALPolicyVerifierV2.sol}"
SNARKJS="$CIRCUITS_DIR/node_modules/.bin/snarkjs"
DEV_BEACON="0000000000000000000000000000000000000000000000000000000000000000"
BEACON_HASH="${ILAL_CEREMONY_BEACON_HASH:-}"

if [ -z "$BEACON_HASH" ]; then
  if [ "${ILAL_UNSAFE_DEV_CEREMONY:-0}" != "1" ]; then
    cat >&2 <<'EOF'
ERROR: no Phase-2 ceremony beacon was supplied.

For a Base Sepolia development verifier only:
  ILAL_UNSAFE_DEV_CEREMONY=1 bash scripts/compile_v2.sh

For production, provide a public unpredictable 64-hex ceremony beacon and
retain the full contribution transcript. Never use the development zkey for
mainnet or customer assets.
EOF
    exit 1
  fi
  BEACON_HASH="$DEV_BEACON"
  echo "WARNING: creating an unsafe TESTNET-ONLY v2 proving key." >&2
fi

if ! [[ "$BEACON_HASH" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "ERROR: ILAL_CEREMONY_BEACON_HASH must be 64 hexadecimal characters." >&2
  exit 1
fi
if [ ! -s "$PTAU_FILE" ]; then
  echo "ERROR: missing $PTAU_FILE" >&2
  exit 1
fi
if [ ! -x "$SNARKJS" ]; then
  echo "ERROR: missing snarkjs executable; run npm ci in $CIRCUITS_DIR" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR" "$(dirname "$CONTRACT_OUT")"

echo "[1/5] Compiling policy circuit v2..."
circom "$CIRCUITS_DIR/v2/ilal_policy.circom" \
  --r1cs --wasm --sym --output "$BUILD_DIR" \
  -l "$CIRCUITS_DIR/node_modules"
"$SNARKJS" r1cs info "$BUILD_DIR/ilal_policy.r1cs"

echo "[2/5] Groth16 setup..."
"$SNARKJS" groth16 setup \
  "$BUILD_DIR/ilal_policy.r1cs" "$PTAU_FILE" "$BUILD_DIR/ilal_policy_0000.zkey"

echo "[3/5] Applying Phase-2 beacon..."
"$SNARKJS" zkey beacon \
  "$BUILD_DIR/ilal_policy_0000.zkey" "$BUILD_DIR/ilal_policy_v2.zkey" "$BEACON_HASH" 10
"$SNARKJS" zkey verify \
  "$BUILD_DIR/ilal_policy.r1cs" "$PTAU_FILE" "$BUILD_DIR/ilal_policy_v2.zkey"

echo "[4/5] Exporting verifier artifacts..."
"$SNARKJS" zkey export verificationkey \
  "$BUILD_DIR/ilal_policy_v2.zkey" "$BUILD_DIR/ilal_policy_v2_vkey.json"
"$SNARKJS" zkey export solidityverifier \
  "$BUILD_DIR/ilal_policy_v2.zkey" "$BUILD_DIR/ILALPolicyVerifierV2.generated.sol"

# snarkjs emits a generic contract name. Rename only the declaration so the
# v1 and v2 generated verifiers can coexist in one Foundry build.
sed 's/contract Groth16Verifier/contract ILALPolicyVerifierV2/' \
  "$BUILD_DIR/ILALPolicyVerifierV2.generated.sol" > "$CONTRACT_OUT"

echo "[5/5] Writing artifact manifest..."
shasum -a 256 \
  "$BUILD_DIR/ilal_policy_v2.zkey" \
  "$BUILD_DIR/ilal_policy_v2_vkey.json" \
  "$BUILD_DIR/ilal_policy_js/ilal_policy.wasm" \
  "$CONTRACT_OUT" \
  > "$BUILD_DIR/SHA256SUMS"
cat "$BUILD_DIR/SHA256SUMS"

echo
echo "v2 verifier build complete (testnet-only unless backed by a reviewed ceremony)."
