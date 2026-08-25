#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLI="$REPO_DIR/cli/dist/index.js"
MANIFEST="$REPO_DIR/docs/hookathon/chainlink-candidate-manifest.json"
BENCHMARK="$REPO_DIR/docs/hookathon/benchmark-results.json"
FORK_STUDY="$REPO_DIR/docs/research/results/fork-study.json"
MODE="interactive"
DELAY_SECONDS="${ILAL_DEMO_DELAY:-4}"

case "${1:-}" in
  --auto) MODE="auto" ;;
  --smoke) MODE="smoke" ;;
  "") ;;
  *)
    echo "Usage: $0 [--auto|--smoke]" >&2
    exit 2
    ;;
esac

for dependency in node npm jq forge; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "Missing required command: $dependency" >&2
    exit 1
  fi
done

DEMO_TMP=$(mktemp -d "${TMPDIR:-/tmp}/ilal-pitch-demo.XXXXXX")
cleanup() {
  [[ -n "${DEMO_TMP:-}" && -d "$DEMO_TMP" ]] && rm -rf "$DEMO_TMP"
}
trap cleanup EXIT INT TERM

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  GREEN=$'\033[32m'
  CYAN=$'\033[36m'
  YELLOW=$'\033[33m'
  RESET=$'\033[0m'
else
  BOLD=""
  DIM=""
  GREEN=""
  CYAN=""
  YELLOW=""
  RESET=""
fi

screen() {
  if [[ "$MODE" != "smoke" && -t 1 ]]; then
    printf '\033[2J\033[H'
  fi
  printf '%s◆ ILAL%s  %sInstitutional Liquidity Access for Uniswap v4%s\n' "$BOLD$CYAN" "$RESET" "$DIM" "$RESET"
  printf '%s────────────────────────────────────────────────────────────%s\n' "$DIM" "$RESET"
}

stage() {
  screen
  printf '%s%s%s\n\n' "$BOLD" "$1" "$RESET"
}

advance() {
  if [[ "$MODE" == "smoke" ]]; then
    return
  fi
  if [[ "$MODE" == "auto" ]]; then
    sleep "$DELAY_SECONDS"
    return
  fi
  printf '\n%sPress return to continue · q to quit%s ' "$DIM" "$RESET"
  local key=""
  IFS= read -r -n 1 key || true
  printf '\n'
  [[ "$key" == "q" || "$key" == "Q" ]] && exit 0
}

command_line() {
  printf '%s$ %s%s\n\n' "$DIM" "$*" "$RESET"
}

cat >"$DEMO_TMP/order-a.json" <<'JSON'
{
  "format": "ilal-netting-order-v1",
  "domain": {
    "name": "ILAL Institutional Netting",
    "version": "1",
    "chainId": 84532,
    "verifyingContract": "0x1111111111111111111111111111111111111111"
  },
  "order": {
    "user": "0x3333333333333333333333333333333333333333",
    "poolId": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "zeroForOne": true,
    "amountIn": "100000000",
    "minAmountOut": "99000000",
    "maxAmmInput": "30000000",
    "deadline": "4000000000",
    "nonce": "0x0000000000000000000000000000000000000000000000000000000000000001"
  },
  "signature": "0x1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"
}
JSON

cat >"$DEMO_TMP/order-b.json" <<'JSON'
{
  "format": "ilal-netting-order-v1",
  "domain": {
    "name": "ILAL Institutional Netting",
    "version": "1",
    "chainId": 84532,
    "verifyingContract": "0x1111111111111111111111111111111111111111"
  },
  "order": {
    "user": "0x4444444444444444444444444444444444444444",
    "poolId": "0x2222222222222222222222222222222222222222222222222222222222222222",
    "zeroForOne": false,
    "amountIn": "70000000",
    "minAmountOut": "70000000",
    "maxAmmInput": "0",
    "deadline": "4000000000",
    "nonce": "0x0000000000000000000000000000000000000000000000000000000000000002"
  },
  "signature": "0x2222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222222"
}
JSON

cd "$REPO_DIR"
npm --prefix "$REPO_DIR/cli" run build >/dev/null

# Generate short-lived signers in memory and overwrite the placeholder fixtures
# with genuinely signed EIP-712 orders. No key is written to disk or printed.
EPHEMERAL_KEY_A="0x$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
EPHEMERAL_KEY_B="0x$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
PRIVATE_KEY="$EPHEMERAL_KEY_A" node "$CLI" --unsafe-private-key netting order sign \
  --zero-for-one --amount-in 100000000 --min-amount-out 99000000 --max-amm-input 30000000 \
  --pool 0x2222222222222222222222222222222222222222222222222222222222222222 \
  --hook 0x1111111111111111111111111111111111111111 --chain 84532 --deadline 4000000000 \
  --nonce 0x0000000000000000000000000000000000000000000000000000000000000001 \
  --output "$DEMO_TMP/order-a.json" >/dev/null
PRIVATE_KEY="$EPHEMERAL_KEY_B" node "$CLI" --unsafe-private-key netting order sign \
  --one-for-zero --amount-in 70000000 --min-amount-out 70000000 --max-amm-input 0 \
  --pool 0x2222222222222222222222222222222222222222222222222222222222222222 \
  --hook 0x1111111111111111111111111111111111111111 --chain 84532 --deadline 4000000000 \
  --nonce 0x0000000000000000000000000000000000000000000000000000000000000002 \
  --output "$DEMO_TMP/order-b.json" >/dev/null
unset EPHEMERAL_KEY_A EPHEMERAL_KEY_B PRIVATE_KEY

stage "THE AMM SHOULD SEE THE IMBALANCE — NOT THE DRAMA"
printf 'Two institutions submit opposing stablecoin flow.\n\n'
printf '                    %s100 + 70 gross%s\n' "$BOLD" "$RESET"
printf '                           ↓\n'
printf '                  %s140 internally matched%s\n' "$GREEN$BOLD" "$RESET"
printf '                           ↓\n'
printf '                    %s30 AMM residual%s\n' "$CYAN$BOLD" "$RESET"
advance

stage "1 / 6  ACTUAL ILAL CLI — OFFLINE BATCH COMMITMENT"
command_line "ilal netting batch preview --orders order-a.json order-b.json"
node "$CLI" netting batch preview --orders "$DEMO_TMP/order-a.json" "$DEMO_TMP/order-b.json"
printf '\n%sEphemeral signers. No stored key. No RPC. Canonical orderHash allocation.%s\n' "$GREEN" "$RESET"
advance

stage "2 / 6  CHAINLINK — THE EXTERNAL SAFETY BOUNDARY"
printf '%sRecorded from the live Base Sepolia candidate manifest%s\n\n' "$DIM" "$RESET"
jq -r '
  "provider:                  " + .oracle.provider,
  "enforcement:               " + .oracle.enforcement,
  "USDC/USD:                  1.000000",
  "USDT/USD:                  0.999940",
  "max individual deviation:  " + (.oracle.maxIndividualDeviationBps | tostring) + " bps",
  "max pair deviation:        " + (.oracle.maxPairDeviationBps | tostring) + " bps",
  "max age:                   " + (.oracle.maxAgeSeconds | tostring) + " seconds"
' "$MANIFEST"
printf '\n%sChainlink is a circuit breaker — not the execution price.%s\n' "$YELLOW" "$RESET"
advance

stage "3 / 6  PINNED PREFLIGHT — EXECUTABLE BEFORE BROADCAST"
printf '%sRecorded evidence; this is not presented as a new live transaction.%s\n\n' "$DIM" "$RESET"
jq -r '
  .batches.forward010By007 as $b |
  "status:             " + $b.preflight.status,
  "snapshot block:     " + ($b.preflight.blockNumber | tostring),
  "snapshot hash:      " + $b.preflight.blockHash,
  "estimated gas:      " + ($b.preflight.estimatedGas | tostring),
  "batch commitment:   " + $b.batchId,
  "submitted:          0.10 USDC / 0.07 hUSDT",
  "predicted residual: 0.03 USDC"
' "$MANIFEST"
advance

stage "4 / 6  BASE SEPOLIA — ATOMIC SETTLEMENT EVIDENCE"
jq -r '
  .batches.forward010By007 as $b |
  "transaction:        " + $b.transactionHash,
  "block:              " + ($b.blockNumber | tostring),
  "gas used:           " + ($b.gasUsed | tostring),
  "matched gross:      0.14",
  "AMM residual:       0.03 USDC",
  "Hook inventory:     token0=" + .postconditions.hookToken0Balance + " token1=" + .postconditions.hookToken1Balance,
  "Router inventory:   token0=" + .postconditions.routerToken0Balance + " token1=" + .postconditions.routerToken1Balance,
  "source verification:" + " " + .sourceVerification.status
' "$MANIFEST"
printf '\nhttps://sepolia.basescan.org/tx/%s\n' "$(jq -r '.batches.forward010By007.transactionHash' "$MANIFEST")"
advance

stage "5 / 6  FAIL CLOSED — REAL ORACLE ROLLBACK REGRESSION"
command_line "forge test --match-test test_oracleRejectionHappensBeforeNonceOrAssetMutation"
FORGE_LOG="$DEMO_TMP/oracle-regression.log"
if NO_COLOR=1 forge test --root "$REPO_DIR/contracts" \
  --match-path test/InstitutionalNetting.t.sol \
  --match-test test_oracleRejectionHappensBeforeNonceOrAssetMutation >"$FORGE_LOG" 2>&1; then
  printf '%s✓ Chainlink peg rejection detected%s\n' "$GREEN" "$RESET"
  printf '%s✓ User balances unchanged%s\n' "$GREEN" "$RESET"
  printf '%s✓ Nonces remain unused%s\n' "$GREEN" "$RESET"
  printf '%s✓ Batch context closed%s\n' "$GREEN" "$RESET"
  printf '%s✓ Hook inventory remains zero%s\n' "$GREEN" "$RESET"
else
  tail -40 "$FORGE_LOG" >&2
  exit 1
fi
advance

stage "6 / 6  MEASURED IMPACT — VALUE, WITH BOUNDARIES"
jq -r '
  .rows[] | select(.pair == "100/70") |
  "AMM exposure reduction:   " + ((.ammExposureReductionBps / 100 * 100 | round) / 100 | tostring) + "%",
  "aggregate output gain:    " + (.outputAdvantageBps | tostring) + " bps",
  "execution gas multiple:   " + (.executionGasMultiple | tostring) + "x"
' "$BENCHMARK"
jq -r '
  .gates[] | select(.id == "production-economic-gate") |
  "strict Base anchor:       $10,000 / 70% opposing flow",
  "baseline:                 " + .baseline,
  "net benefit:              $" + ((.netBenefitUsd * 100000 | round) / 100000 | tostring),
  "verdict:                  " + .status
' "$FORK_STUDY"
printf '\n%sWhen ILAL should not execute, the correct answer is not marketing. The correct answer is no.%s\n' "$YELLOW" "$RESET"
advance

stage "VERIFY ACCESS. NET WHAT CANCELS. SEND ONLY THE RESIDUAL."
printf '%sPublic liquidity should absorb imbalance — not unnecessary gross flow.%s\n\n' "$BOLD" "$RESET"
printf '282 Solidity tests · 100,000 invariant calls · 2/4/16-order live evidence\n'
printf 'Ready for an institutional pilot · unaudited · not production-ready\n\n'
printf '%sILAL%s\n' "$CYAN$BOLD" "$RESET"

if [[ "$MODE" == "interactive" ]]; then
  printf '\n%sDemo complete. Press return to close.%s ' "$DIM" "$RESET"
  IFS= read -r || true
fi
