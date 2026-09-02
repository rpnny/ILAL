#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
RPC_URL="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"

if [[ -z "${ETHERSCAN_API_KEY:-}" ]]; then
  echo "ETHERSCAN_API_KEY is required for BaseScan/Etherscan native verification." >&2
  echo "Export it in this shell, then run this script again. The key is never printed." >&2
  exit 2
fi

# Foundry can otherwise reuse an artifact compiled before remapping changes.
# The executable bytecode is identical, but a stale Solidity metadata hash makes
# Etherscan's local bytecode preflight fail. Rebuild once from the checked-in
# configuration before submitting any verification job.
echo "Rebuilding verification artifacts from the current Foundry configuration..."
forge build --root "$CONTRACTS_DIR" --force --quiet

verify() {
  local address="$1"
  local contract="$2"
  local creation_tx="$3"
  local constructor_args="${4:-}"
  local -a verify_command=(
    forge verify-contract
    --root "$CONTRACTS_DIR"
    --chain 84532
    --rpc-url "$RPC_URL"
    --verifier etherscan
    --watch
  )

  if [[ -n "$constructor_args" ]]; then
    verify_command+=(--constructor-args "$constructor_args")
  fi

  verify_command+=(
    --creation-transaction-hash "$creation_tx"
    "$address"
    "$contract"
  )

  echo "Verifying $contract at $address"
  "${verify_command[@]}"
}

verify "0x0F948da2f54D9d0Ab31169D854dc655eEB3D1472" \
  "src/ILALRouter.sol:ILALRouter" \
  "0xafd312beed30d3ce0ba001b7af0f0cbd5838a3690d88b666667cbc04ee76f099" \
  "$(cast abi-encode 'constructor(address,address,uint24)' \
    0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
    0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58 \
    50)"
verify "0x936afAca590957f446B1603DbA6eC3Af298a039a" \
  "src/v2/EligibilityPolicyRegistryV2.sol:EligibilityPolicyRegistryV2" \
  "0xebaa26d119001354a9a63ca0b397cc55fd63a78fcc57b1ee58df4505e0276ef3" \
  "$(cast abi-encode 'constructor(address)' \
    0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58)"
verify "0x7C2ef9A7eBb263F3Dd1007a2Eb4068fde11AF39e" \
  "src/verifier/ILALPolicyVerifierV2.sol:ILALPolicyVerifierV2" \
  "0xa704272035a041e3fabacecb7f565e259ece152bfebe18491aa8de3fdc8b6eb3"
verify "0x3144B398057642252622266E840dAc8a2CC6Ac6E" \
  "src/v2/Groth16VerifierAdapterV2.sol:Groth16VerifierAdapterV2" \
  "0xce74ac1d64dd39e7cfe6976aae7666f3a7e18f5c062614fefc5856e8204c3468" \
  "$(cast abi-encode 'constructor(address)' \
    0x7C2ef9A7eBb263F3Dd1007a2Eb4068fde11AF39e)"
verify "0xeF0e54C22361fE567157f6302Ae0363474f6d4E3" \
  "src/v2/PolicyGrantManagerV2.sol:PolicyGrantManagerV2" \
  "0x8c7315eb14e70c803d4a87369142914aefc542be22be234026f8cd442cf3caa3" \
  "$(cast abi-encode 'constructor(address,address,address)' \
    0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58 \
    0x3144B398057642252622266E840dAc8a2CC6Ac6E \
    0x936afAca590957f446B1603DbA6eC3Af298a039a)"
verify "0x9238103A1bd611461E1bDcB2084D166EB7AeCA80" \
  "src/v2/ComplianceHookV2.sol:ComplianceHookV2" \
  "0x3c11887d5dd9f89307bdfe2aaa67fc37c143790f83d8b0e5bbd058b58e4d309d" \
  "$(cast abi-encode 'constructor(address,address,address,address)' \
    0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
    0x936afAca590957f446B1603DbA6eC3Af298a039a \
    0xeF0e54C22361fE567157f6302Ae0363474f6d4E3 \
    0x0F948da2f54D9d0Ab31169D854dc655eEB3D1472)"

echo "BaseScan-native verification submissions completed."
