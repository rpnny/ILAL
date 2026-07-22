#!/usr/bin/env bash
# gen_test_proof.sh — generates a real Groth16 proof for a test wallet.
# Used to verify the full pipeline works before demo day.
#
# Usage: bash scripts/gen_test_proof.sh [wallet_address]
#
# Default wallet: 0x1b869CaC69Df23Ad9D727932496AEb3605538c8D (demo wallet)

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$CIRCUITS_DIR/build"
OUT_DIR="$CIRCUITS_DIR/outputs"

mkdir -p "$OUT_DIR"

# All node -e calls must resolve requires from circuits/node_modules
cd "$CIRCUITS_DIR"

WALLET="${1:-0x1b869CaC69Df23Ad9D727932496AEb3605538c8D}"

echo
echo "  ILAL Test Proof Generator"
echo "  wallet: $WALLET"
echo

# ── Derive walletField and walletBits from wallet address ─────────────────────
# wallet as decimal BigInt (uint160)
WALLET_HEX="${WALLET#0x}"
WALLET_FIELD=$(python3 -c "print(int('$WALLET_HEX', 16))")

# walletBits: 160 bits, LSB first
WALLET_BITS=$(python3 -c "
n = int('$WALLET_HEX', 16)
bits = [(n >> i) & 1 for i in range(160)]
print('[' + ','.join(map(str, bits)) + ']')
")

# walletHash = keccak256(abi.encodePacked(wallet)) >> 4
# cast keccak computes keccak256 of the raw bytes of the hex input
KECCAK_HEX=$(cast keccak "0x${WALLET_HEX}")
WALLET_HASH=$(python3 -c "print(int('${KECCAK_HEX}', 16) >> 4)")

# ── Build minimal Merkle tree with just this wallet ───────────────────────────
EXPIRES_AT=$(date -v+90d +%s 2>/dev/null || date -d '+90 days' +%s)

# Compute leaf = Poseidon(walletField, 2, 840, expiresAt) using snarkjs poseidon
LEAF=$(node -e "
const { buildPoseidon } = require('circomlibjs');
buildPoseidon().then(poseidon => {
  const F = poseidon.F;
  const leaf = poseidon([BigInt('$WALLET_FIELD'), 2n, 840n, ${EXPIRES_AT}n]);
  console.log(F.toObject(leaf).toString());
});
" 2>/dev/null || echo "0")

echo "walletField: $WALLET_FIELD"
echo "expiresAt:   $EXPIRES_AT"

# ── Build input.json ──────────────────────────────────────────────────────────
node -e "
const { IncrementalMerkleTree } = require('@zk-kit/incremental-merkle-tree');
const { buildPoseidon } = require('circomlibjs');

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // IncrementalMerkleTree v1.x passes an array to the hash function
  const poseidon2 = (inputs) => F.toObject(poseidon(inputs));
  const poseidon4 = (inputs) => F.toObject(poseidon(inputs));

  const walletField = BigInt('$WALLET_FIELD');
  const kycLevel    = 2n;
  const countryCode = 840n;
  const expiresAt   = ${EXPIRES_AT}n;

  const leaf = poseidon4([walletField, kycLevel, countryCode, expiresAt]);

  const tree = new IncrementalMerkleTree(poseidon2, 20, 0n, 2);
  tree.insert(leaf);

  const proof = tree.createProof(0);
  const root  = tree.root;

  // walletBits: LSB first
  const bits = [];
  for (let i = 0; i < 160; i++) bits.push(Number((walletField >> BigInt(i)) & 1n));

  const input = {
    // Private
    walletField:        walletField.toString(),
    walletBits:         bits.map(String),
    kycLevel:           kycLevel.toString(),
    countryCode:        countryCode.toString(),
    merklePathElements: proof.siblings.map(s => s[0].toString()),
    merklePathIndices:  proof.pathIndices.map(String),

    // Public — must match circuit-computed keccak256(wallet) >> 4
    walletHash:   '${WALLET_HASH}',
    issuerHash:   '0',
    schemaHash:   '0',
    expiresAt:    expiresAt.toString(),
    revealFlags:  '0',
    merkleRoot:   root.toString(),
  };

  const fs = require('fs');
  fs.writeFileSync('$OUT_DIR/input.json', JSON.stringify(input, null, 2));
  fs.writeFileSync('$OUT_DIR/root.txt', root.toString());
  console.log('merkleRoot:', root.toString());
}
main().catch(console.error);
" 2>&1

echo
echo "[1/3] Generating witness…"
node "$BUILD_DIR/ilal_js/generate_witness.js" \
  "$BUILD_DIR/ilal_js/ilal.wasm" \
  "$OUT_DIR/input.json" \
  "$OUT_DIR/witness.wtns" 2>&1

echo "[2/3] Generating proof…"
npx snarkjs groth16 prove \
  "$BUILD_DIR/ilal.zkey" \
  "$OUT_DIR/witness.wtns" \
  "$OUT_DIR/proof.json" \
  "$OUT_DIR/public.json" 2>&1

echo "[3/3] Verifying proof locally…"
npx snarkjs groth16 verify \
  "$BUILD_DIR/ilal_vkey.json" \
  "$OUT_DIR/public.json" \
  "$OUT_DIR/proof.json" 2>&1

echo
echo "  Proof verified OK"
echo "  public.json → $OUT_DIR/public.json"
echo "  proof.json  → $OUT_DIR/proof.json"
echo
echo "  Mint credential:"
echo "    ilal proof mint \\"
echo "      --proof $OUT_DIR/proof.json \\"
echo "      --public $OUT_DIR/public.json \\"
echo "      --issuer 0x319c0F1cb46c85B42E051251c4db04BA6BD265a2 \\"
echo "      --chain 84532"
