#!/usr/bin/env bash

set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ILAL_V2_BUILD_DIR:-$CIRCUITS_DIR/build-v2}"
PTAU_FILE="${ILAL_V2_PTAU_FILE:-$CIRCUITS_DIR/ptau/pot18_final.ptau}"
PTAU_DIR="$(dirname "$PTAU_FILE")"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_18.ptau"
PTAU_SHA256="e970efa7774da80101e0ac336d083ef3339855c98112539338d706b2b89ac694"

artifacts_ready() {
  test -s "$BUILD_DIR/ilal_policy_js/ilal_policy.wasm" \
    && test -s "$BUILD_DIR/ilal_policy_v2.zkey" \
    && test -s "$BUILD_DIR/ilal_policy_v2_vkey.json"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

if artifacts_ready; then
  echo "V2 proving artifacts already available: $BUILD_DIR"
  exit 0
fi

mkdir -p "$PTAU_DIR"
if [ ! -s "$PTAU_FILE" ] || [ "$(sha256_file "$PTAU_FILE")" != "$PTAU_SHA256" ]; then
  ptau_download="$PTAU_FILE.download"
  echo "Downloading pinned Powers of Tau for the testnet-only V2 proving key..."
  curl --fail --location --retry 3 --retry-all-errors --output "$ptau_download" "$PTAU_URL"
  downloaded_sha256="$(sha256_file "$ptau_download")"
  if [ "$downloaded_sha256" != "$PTAU_SHA256" ]; then
    echo "ERROR: downloaded Powers of Tau SHA-256 mismatch: $downloaded_sha256" >&2
    exit 1
  fi
  mv "$ptau_download" "$PTAU_FILE"
fi

actual_ptau_sha256="$(sha256_file "$PTAU_FILE")"
if [ "$actual_ptau_sha256" != "$PTAU_SHA256" ]; then
  echo "ERROR: Powers of Tau SHA-256 mismatch: $actual_ptau_sha256" >&2
  exit 1
fi

temporary_verifier="${ILAL_V2_VERIFIER_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ILALPolicyVerifierV2.ci.sol}"
ILAL_UNSAFE_DEV_CEREMONY=1 \
ILAL_V2_BUILD_DIR="$BUILD_DIR" \
ILAL_V2_PTAU_FILE="$PTAU_FILE" \
ILAL_V2_VERIFIER_OUT="$temporary_verifier" \
  bash "$CIRCUITS_DIR/scripts/compile_v2.sh"

artifacts_ready || {
  echo "ERROR: V2 proving artifact preparation did not produce the required files" >&2
  exit 1
}

echo "Prepared testnet-only V2 proving artifacts: $BUILD_DIR"
