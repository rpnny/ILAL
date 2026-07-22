#!/usr/bin/env bash
# compile.sh — Full ILAL circuit build pipeline.
#
# Steps:
#   1. Compile ilal.circom → R1CS + WASM + witness generator
#   2. Download/verify Powers of Tau (Hermez ceremony, 2^22 constraints)
#   3. Groth16 setup → initial zkey
#   4. Phase 2 contribution (add entropy — REPLACE the beacon value for production)
#   5. Export final zkey + Solidity verifier
#
# Prerequisites:
#   npm install      (in circuits/)
#   circom 2.x       (https://docs.circom.io/getting-started/installation/)
#
# Usage:
#   bash scripts/compile.sh
#
# After running, outputs are in build/:
#   build/ilal.r1cs         — constraint system
#   build/ilal.zkey         — proving key (distribute to provers)
#   build/ilal_vkey.json    — verification key (public)
#   build/ilal_js/ilal.wasm — witness generator WASM
#   build/ILALVerifier.sol  — Solidity Groth16 verifier (copy to contracts/)

set -euo pipefail

DEV_BEACON="0000000000000000000000000000000000000000000000000000000000000000"
BEACON_HASH="${ILAL_CEREMONY_BEACON_HASH:-}"

if [ -z "$BEACON_HASH" ]; then
  if [ "${ILAL_UNSAFE_DEV_CEREMONY:-0}" != "1" ]; then
    cat >&2 <<'EOF'
ERROR: no Phase-2 ceremony beacon was supplied.

Production build:
  export ILAL_CEREMONY_BEACON_HASH=<64-hex public unpredictable beacon>
  bash scripts/compile.sh

Local demo only (creates an explicitly unsafe development zkey):
  ILAL_UNSAFE_DEV_CEREMONY=1 bash scripts/compile.sh

Never deploy or publish the development zkey as a production proving key.
EOF
    exit 1
  fi
  BEACON_HASH="$DEV_BEACON"
  echo "WARNING: building with the known development beacon; proofs are NOT production-safe." >&2
fi

if ! [[ "$BEACON_HASH" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "ERROR: ILAL_CEREMONY_BEACON_HASH must be exactly 64 hexadecimal characters." >&2
  exit 1
fi

if [ "$BEACON_HASH" = "$DEV_BEACON" ] && [ "${ILAL_UNSAFE_DEV_CEREMONY:-0}" != "1" ]; then
  echo "ERROR: the zero development beacon requires ILAL_UNSAFE_DEV_CEREMONY=1." >&2
  exit 1
fi

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
PTAU_DIR="$CIRCUITS_DIR/ptau"

mkdir -p "$BUILD_DIR" "$PTAU_DIR"

echo
echo "  ILAL Circuit Build Pipeline"
echo "  ═══════════════════════════"
echo

# ─── Step 1: Compile circuit ──────────────────────────────────────────────────

echo "[1/5] Compiling ilal.circom…"
circom "$CIRCUITS_DIR/ilal.circom" \
  --r1cs \
  --wasm \
  --sym \
  --output "$BUILD_DIR" \
  -l "$CIRCUITS_DIR/node_modules"

echo "      Constraints:"
npx snarkjs r1cs info "$BUILD_DIR/ilal.r1cs" | grep "# of Constraints"

# ─── Step 2: Powers of Tau ────────────────────────────────────────────────────
# We use the Hermez perpetual powers of tau (2^22 = 4M constraints).
# The ILAL circuit is ~300k constraints (keccak256 dominates). 2^19 = 512k is
# sufficient, but we use 2^22 for headroom.
#
# File: powersOfTau28_hez_final_22.ptau  (1.8 GB)
# SHA256: see https://github.com/iden3/snarkjs#7-prepare-phase-2

# pot18 supports 2^18 = 262,144 constraints.
# ILAL circuit: ~158k non-linear + ~93k linear = ~250k total. pot18 fits.
PTAU_FILE="$PTAU_DIR/pot18_final.ptau"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_18.ptau"

echo
echo "[2/5] Powers of Tau…"
if [ ! -f "$PTAU_FILE" ] || [ "$(wc -c < "$PTAU_FILE")" -lt 1000000 ]; then
  echo "      Downloading (~260 MB)…"
  curl -L --progress-bar -o "$PTAU_FILE" "$PTAU_URL"
else
  echo "      Found cached: $PTAU_FILE ($(du -sh "$PTAU_FILE" | cut -f1))"
fi

# ─── Step 3: Initial zkey (Groth16 setup) ─────────────────────────────────────

echo
echo "[3/5] Groth16 setup (zkey phase 1)…"
npx snarkjs groth16 setup \
  "$BUILD_DIR/ilal.r1cs" \
  "$PTAU_FILE" \
  "$BUILD_DIR/ilal_0000.zkey"

# ─── Step 4: Phase 2 contribution ─────────────────────────────────────────────
# IMPORTANT: For production, replace the beacon below with the output of a
# real multi-party ceremony (e.g., using snarkjs zkey contribute for each
# participant). The beacon value here is for development only.
#
# For a ceremony: distribute ilal_0000.zkey → participants run
#   snarkjs zkey contribute ilal_N.zkey ilal_N+1.zkey --name "Participant N"
# Then finalize with:
#   snarkjs zkey beacon ilal_Nfinal.zkey ilal.zkey <random_beacon_hash> 10

echo
echo "[4/5] Phase 2 contribution…"
echo "      NOTE: Use a real ceremony for production. This is a dev-only beacon."

npx snarkjs zkey beacon \
  "$BUILD_DIR/ilal_0000.zkey" \
  "$BUILD_DIR/ilal.zkey" \
  "$BEACON_HASH" \
  10

# Verify final zkey
npx snarkjs zkey verify \
  "$BUILD_DIR/ilal.r1cs" \
  "$PTAU_FILE" \
  "$BUILD_DIR/ilal.zkey"

# ─── Step 5: Export verification key + Solidity verifier ─────────────────────

echo
echo "[5/5] Exporting vkey and Solidity verifier…"

npx snarkjs zkey export verificationkey \
  "$BUILD_DIR/ilal.zkey" \
  "$BUILD_DIR/ilal_vkey.json"

npx snarkjs zkey export solidityverifier \
  "$BUILD_DIR/ilal.zkey" \
  "$BUILD_DIR/ILALVerifier.sol"

# Copy verifier into contracts, wrapping it with the adapter
cp "$BUILD_DIR/ILALVerifier.sol" \
   "$CIRCUITS_DIR/../contracts/src/verifier/ILALVerifier.sol"

echo
echo "  Build complete!"
echo "  Artifact SHA-256 manifest:"
for artifact in \
  "$BUILD_DIR/ilal.zkey" \
  "$BUILD_DIR/ilal_vkey.json" \
  "$BUILD_DIR/ilal_js/ilal.wasm" \
  "$BUILD_DIR/ilal_js/generate_witness.js" \
  "$BUILD_DIR/ilal_js/witness_calculator.js"; do
  shasum -a 256 "$artifact"
done
echo
echo "  Next steps:"
echo "  ┌─ 1. Copy verifier ─────────────────────────────────────────────────┐"
echo "  │     contracts/src/verifier/ILALVerifier.sol is ready               │"
echo "  │     Deploy it, then propose/activate the verifier after 72 hours   │"
echo "  ├─ 2. Build attestation tree ────────────────────────────────────────┤"
echo "  │     npx tsx oracle/build_tree.ts --input oracle/attestations.json  │"
echo "  │     Propose/activate the root after the 48-hour review delay       │"
echo "  ├─ 3. Generate a proof ──────────────────────────────────────────────┤"
echo "  │     npx tsx oracle/generate_witness.ts --wallet 0x... \\            │"
echo "  │       --issuer <CNFIssuer> --schema <schemaUID>                    │"
echo "  └─ 4. Mint ──────────────────────────────────────────────────────────┘"
echo "        ilal proof mint --proof outputs/proof.json \\"
echo "          --public outputs/public.json --issuer <CNFIssuer>"
echo
