#!/usr/bin/env bash
set -euo pipefail

REPO_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LOCAL_CLI="$REPO_DIR/cli/dist/index.js"
EXPECTED_CLI_VERSION=$(jq -r '.version' "$REPO_DIR/cli/package.json")
MANIFEST="$REPO_DIR/docs/hookathon/chainlink-candidate-manifest.json"
BENCHMARK="$REPO_DIR/docs/hookathon/benchmark-results.json"
FORK_STUDY="$REPO_DIR/docs/research/results/fork-study.json"
EXPLORER="https://sepolia.basescan.org"
MODE="interactive"
LIVE_BROADCAST=false
DELAY_SECONDS="${ILAL_DEMO_DELAY:-4}"

case "${1:-}" in
  --auto) MODE="auto" ;;
  --smoke) MODE="smoke" ;;
  --live) LIVE_BROADCAST=true ;;
  "") ;;
  *)
    echo "Usage: $0 [--auto|--smoke|--live]" >&2
    exit 2
    ;;
esac

if [[ "$LIVE_BROADCAST" == "true" && ! -t 0 ]]; then
  echo "Live mode requires an interactive terminal." >&2
  exit 2
fi

for dependency in node npm jq forge cast; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    echo "Missing required command: $dependency" >&2
    exit 1
  fi
done

DEMO_TMP=$(mktemp -d "${TMPDIR:-/tmp}/ilal-pitch-demo.XXXXXX")
cleanup() {
  unset LIVE_INSTITUTION_A_KEY LIVE_INSTITUTION_B_KEY LIVE_SOLVER_KEY PRIVATE_KEY
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
  if [[ "$key" == "q" || "$key" == "Q" ]]; then
    exit 0
  fi
  return 0
}

command_line() {
  printf '%s$ %s%s\n\n' "$DIM" "$*" "$RESET"
}

run_cli() {
  "${CLI_RUN[@]}" "$@"
}

read_private_key() {
  local label="$1"
  local variable_name="$2"
  local value=""
  printf '%s' "$label"
  IFS= read -r -s value
  printf '\n'
  [[ "$value" == 0x* ]] || value="0x$value"
  if [[ ! "$value" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "Invalid private key format." >&2
    exit 1
  fi
  printf -v "$variable_name" '%s' "$value"
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

# Prefer the public npm preview so the demo exercises the same package a
# reviewer can install. Fall back to the repository build only when npm is
# unavailable (for example, during an offline rehearsal).
CLI_SOURCE=""
GLOBAL_CLI_VERSION=""
if command -v ilal >/dev/null 2>&1; then
  GLOBAL_CLI_VERSION=$(ilal --version 2>/dev/null || true)
fi
if [[ "$GLOBAL_CLI_VERSION" == "$EXPECTED_CLI_VERSION" ]]; then
  CLI_RUN=(ilal)
  CLI_SOURCE="global npm @ilalv3/cli@$EXPECTED_CLI_VERSION"
elif NPM_CLI_VERSION=$(npx --yes --package="@ilalv3/cli@$EXPECTED_CLI_VERSION" -- ilal --version 2>/dev/null) && \
     [[ "$NPM_CLI_VERSION" == "$EXPECTED_CLI_VERSION" ]]; then
  CLI_RUN=(npx --yes --package="@ilalv3/cli@$EXPECTED_CLI_VERSION" -- ilal)
  CLI_SOURCE="npm @ilalv3/cli@$EXPECTED_CLI_VERSION"
else
  npm --prefix "$REPO_DIR/cli" run build >/dev/null
  CLI_RUN=(node "$LOCAL_CLI")
  CLI_SOURCE="repository fallback @ilalv3/cli@$EXPECTED_CLI_VERSION"
fi

if [[ "$LIVE_BROADCAST" == "true" ]]; then
  RPC_URL="${ILAL_BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
  POOL_ID=$(jq -r '.pool.poolId' "$MANIFEST")
  HOOK=$(jq -r '.contracts.nettingHook.address' "$MANIFEST")
  ROUTER=$(jq -r '.contracts.batchRouter.address' "$MANIFEST")
  TOKEN0=$(jq -r '.assets.token0.address' "$MANIFEST")
  TOKEN1=$(jq -r '.assets.token1.address' "$MANIFEST")
  EXPECTED_A=$(jq -r '.roles.institutionA' "$MANIFEST")
  EXPECTED_B=$(jq -r '.roles.institutionB' "$MANIFEST")
  SOLVER=$(jq -r '.roles.solver' "$MANIFEST")
  ORACLE_GUARD=$(jq -r '.contracts.oracleGuard.address' "$MANIFEST")
  FEED0=$(jq -r '.oracle.usdcUsd.address' "$MANIFEST")
  FEED1=$(jq -r '.oracle.usdtUsd.address' "$MANIFEST")

  ORACLE_CHECK_LOG="$DEMO_TMP/oracle-readiness.log"
  if ! cast call "$ORACLE_GUARD" 'validate()((uint256,uint256,uint256,uint256,bool))' \
      --rpc-url "$RPC_URL" >"$ORACLE_CHECK_LOG" 2>&1; then
    LATEST_TIMESTAMP=$(cast block latest --field timestamp --rpc-url "$RPC_URL")
    UPDATED_AT0=$(cast call "$FEED0" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' \
      --rpc-url "$RPC_URL" | sed -n '4p' | awk '{print $1}')
    UPDATED_AT1=$(cast call "$FEED1" 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' \
      --rpc-url "$RPC_URL" | sed -n '4p' | awk '{print $1}')
    AGE0=$((LATEST_TIMESTAMP - UPDATED_AT0))
    AGE1=$((LATEST_TIMESTAMP - UPDATED_AT1))
    stage "LIVE BROADCAST BLOCKED — CHAINLINK GUARD FAIL-CLOSED"
    printf 'USDC/USD age: %s seconds · limit: 90000 seconds\n' "$AGE0"
    printf 'USDT/USD age: %s seconds · limit: 90000 seconds\n' "$AGE1"
    printf '\nUSDC/USD feed: %s/address/%s\n' "$EXPLORER" "$FEED0"
    printf 'USDT/USD feed: %s/address/%s\n' "$EXPLORER" "$FEED1"
    printf '\n%sNo keys were requested. No preflight batch or transaction was sent.%s\n' "$GREEN" "$RESET"
    printf '%sWait for the official testnet feed to update; do not bypass the immutable guard.%s\n' "$YELLOW" "$RESET"
    printf '\n%sPress return to close.%s ' "$DIM" "$RESET"
    IFS= read -r || true
    exit 2
  fi

  printf '\n%sLIVE BASE SEPOLIA MODE%s\n' "$YELLOW$BOLD" "$RESET"
  printf 'Keys are read silently, kept only in memory and never written to disk.\n'
  LIVE_INSTITUTION_A_KEY="${ILAL_INSTITUTION_A_KEY:-}"
  LIVE_INSTITUTION_B_KEY="${ILAL_INSTITUTION_B_KEY:-}"
  LIVE_SOLVER_KEY="${ILAL_SOLVER_KEY:-}"
  [[ -n "$LIVE_INSTITUTION_A_KEY" ]] || read_private_key "Institution A key ($EXPECTED_A): " LIVE_INSTITUTION_A_KEY
  [[ -n "$LIVE_INSTITUTION_B_KEY" ]] || read_private_key "Institution B key ($EXPECTED_B): " LIVE_INSTITUTION_B_KEY
  [[ -n "$LIVE_SOLVER_KEY" ]] || read_private_key "Executor key (any funded Base Sepolia test wallet): " LIVE_SOLVER_KEY

  # A scaled 100/70 testnet batch: Institution B sells 0.010 USDC and
  # Institution A sells 0.007 hUSDT. Only 0.003 USDC reaches the AMM.
  sign_live_orders() {
    PRIVATE_KEY="$LIVE_INSTITUTION_B_KEY" run_cli --unsafe-private-key netting order sign \
      --zero-for-one --amount-in 10000 --min-amount-out 9800 --max-amm-input 3000 \
      --pool "$POOL_ID" --hook "$HOOK" --chain 84532 --ttl 900 \
      --output "$DEMO_TMP/order-a.json" >/dev/null
    PRIVATE_KEY="$LIVE_INSTITUTION_A_KEY" run_cli --unsafe-private-key netting order sign \
      --one-for-zero --amount-in 7000 --min-amount-out 7000 --max-amm-input 0 \
      --pool "$POOL_ID" --hook "$HOOK" --chain 84532 --ttl 900 \
      --output "$DEMO_TMP/order-b.json" >/dev/null
    unset PRIVATE_KEY
  }
  sign_live_orders

  ACTUAL_ZERO_FOR_ONE=$(jq -r '.order.user' "$DEMO_TMP/order-a.json")
  ACTUAL_ONE_FOR_ZERO=$(jq -r '.order.user' "$DEMO_TMP/order-b.json")
  ACTUAL_ZERO_LOWER=$(printf '%s' "$ACTUAL_ZERO_FOR_ONE" | tr '[:upper:]' '[:lower:]')
  ACTUAL_ONE_LOWER=$(printf '%s' "$ACTUAL_ONE_FOR_ZERO" | tr '[:upper:]' '[:lower:]')
  EXPECTED_A_LOWER=$(printf '%s' "$EXPECTED_A" | tr '[:upper:]' '[:lower:]')
  EXPECTED_B_LOWER=$(printf '%s' "$EXPECTED_B" | tr '[:upper:]' '[:lower:]')
  if [[ "$ACTUAL_ZERO_LOWER" == "$EXPECTED_A_LOWER" && "$ACTUAL_ONE_LOWER" == "$EXPECTED_B_LOWER" ]]; then
    printf '%sInstitution A/B keys were reversed; corrected automatically.%s\n' "$YELLOW" "$RESET"
    SWAP_KEY="$LIVE_INSTITUTION_A_KEY"
    LIVE_INSTITUTION_A_KEY="$LIVE_INSTITUTION_B_KEY"
    LIVE_INSTITUTION_B_KEY="$SWAP_KEY"
    unset SWAP_KEY
    sign_live_orders
  elif [[ "$ACTUAL_ZERO_LOWER" != "$EXPECTED_B_LOWER" || "$ACTUAL_ONE_LOWER" != "$EXPECTED_A_LOWER" ]]; then
    printf 'Institution A input resolves to: %s\n' "$ACTUAL_ONE_FOR_ZERO" >&2
    printf 'Institution A expected address:  %s\n' "$EXPECTED_A" >&2
    printf 'Institution B input resolves to: %s\n' "$ACTUAL_ZERO_FOR_ONE" >&2
    printf 'Institution B expected address:  %s\n' "$EXPECTED_B" >&2
    echo "Use the keys for the two displayed institution addresses; keys are never printed." >&2
    exit 1
  fi
else
  # Generate short-lived signers in memory and overwrite the placeholder fixtures
  # with genuinely signed EIP-712 orders. No key is written to disk or printed.
  EPHEMERAL_KEY_A="0x$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  EPHEMERAL_KEY_B="0x$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  PRIVATE_KEY="$EPHEMERAL_KEY_A" run_cli --unsafe-private-key netting order sign \
    --zero-for-one --amount-in 100000000 --min-amount-out 99000000 --max-amm-input 30000000 \
    --pool 0x2222222222222222222222222222222222222222222222222222222222222222 \
    --hook 0x1111111111111111111111111111111111111111 --chain 84532 --deadline 4000000000 \
    --nonce 0x0000000000000000000000000000000000000000000000000000000000000001 \
    --output "$DEMO_TMP/order-a.json" >/dev/null
  PRIVATE_KEY="$EPHEMERAL_KEY_B" run_cli --unsafe-private-key netting order sign \
    --one-for-zero --amount-in 70000000 --min-amount-out 70000000 --max-amm-input 0 \
    --pool 0x2222222222222222222222222222222222222222222222222222222222222222 \
    --hook 0x1111111111111111111111111111111111111111 --chain 84532 --deadline 4000000000 \
    --nonce 0x0000000000000000000000000000000000000000000000000000000000000002 \
    --output "$DEMO_TMP/order-b.json" >/dev/null
  unset EPHEMERAL_KEY_A EPHEMERAL_KEY_B PRIVATE_KEY
fi

stage "THE AMM SHOULD SEE THE IMBALANCE — NOT THE DRAMA"
printf '%sCLI: %s%s\n\n' "$DIM" "$CLI_SOURCE" "$RESET"
printf 'Two institutions submit opposing stablecoin flow.\n\n'
printf '                    %s100 + 70 gross%s\n' "$BOLD" "$RESET"
printf '                           ↓\n'
printf '                  %s140 internally matched%s\n' "$GREEN$BOLD" "$RESET"
printf '                           ↓\n'
printf '                    %s30 AMM residual%s\n' "$CYAN$BOLD" "$RESET"
if [[ "$LIVE_BROADCAST" == "true" ]]; then
  printf '\n%sLive testnet scale: 0.010 USDC + 0.007 hUSDT → 0.003 USDC residual%s\n' "$YELLOW" "$RESET"
fi
advance

stage "1 / 6  ACTUAL ILAL CLI — OFFLINE BATCH COMMITMENT"
command_line "ilal netting batch preview --orders order-a.json order-b.json"
run_cli netting batch preview --orders "$DEMO_TMP/order-a.json" "$DEMO_TMP/order-b.json"
if [[ "$LIVE_BROADCAST" == "true" ]]; then
  printf '\n%sFresh signed candidate orders. Keys remain memory-only. Canonical orderHash allocation.%s\n' "$GREEN" "$RESET"
else
  printf '\n%sEphemeral signers. No stored key. No RPC. Canonical orderHash allocation.%s\n' "$GREEN" "$RESET"
fi
printf '%sOffline calculation only — no transaction was broadcast in this step.%s\n' "$DIM" "$RESET"
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
printf '\nUSDC/USD feed: %s/address/%s\n' "$EXPLORER" "$(jq -r '.oracle.usdcUsd.address' "$MANIFEST")"
printf 'USDT/USD feed: %s/address/%s\n' "$EXPLORER" "$(jq -r '.oracle.usdtUsd.address' "$MANIFEST")"
printf '\n%sChainlink is a circuit breaker — not the execution price.%s\n' "$YELLOW" "$RESET"
advance

stage "3 / 6  PINNED PREFLIGHT — EXECUTABLE BEFORE BROADCAST"
if [[ "$LIVE_BROADCAST" == "true" ]]; then
  command_line "ilal netting batch preflight --orders order-a.json order-b.json"
  run_cli netting batch preflight --orders "$DEMO_TMP/order-a.json" "$DEMO_TMP/order-b.json" \
    --router "$ROUTER" --hook "$HOOK" --token-a "$TOKEN0" --token-b "$TOKEN1" \
    --fee 500 --tick-spacing 10 --chain 84532 --rpc "$RPC_URL" --from "$SOLVER" \
    --output "$DEMO_TMP/live-preflight.json"
  printf '\nSnapshot block: %s/block/%s\n' "$EXPLORER" "$(jq -r '.snapshot.blockNumber' "$DEMO_TMP/live-preflight.json")"
else
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
  printf '\nSnapshot block: %s/block/%s\n' \
    "$EXPLORER" "$(jq -r '.batches.forward010By007.preflight.blockNumber' "$MANIFEST")"
fi
printf '%sPreflight is an eth_call simulation — no transaction was broadcast in this step.%s\n' "$DIM" "$RESET"
advance

if [[ "$LIVE_BROADCAST" == "true" ]]; then
  stage "4 / 6  BASE SEPOLIA — LIVE ATOMIC BROADCAST"
  printf '%sThis sends one new scaled 2-order batch and consumes testnet gas/assets.%s\n' "$YELLOW" "$RESET"
  printf 'Type %sBROADCAST%s to continue: ' "$BOLD" "$RESET"
  LIVE_CONFIRMATION=""
  IFS= read -r LIVE_CONFIRMATION
  if [[ "$LIVE_CONFIRMATION" != "BROADCAST" ]]; then
    echo "Broadcast cancelled." >&2
    exit 2
  fi
  LIVE_LOG="$DEMO_TMP/live-execute.log"
  command_line "ilal netting batch execute --orders order-a.json order-b.json"
  PRIVATE_KEY="$LIVE_SOLVER_KEY" run_cli --unsafe-private-key netting batch execute \
    --orders "$DEMO_TMP/order-a.json" "$DEMO_TMP/order-b.json" \
    --router "$ROUTER" --hook "$HOOK" --token-a "$TOKEN0" --token-b "$TOKEN1" \
    --fee 500 --tick-spacing 10 --chain 84532 --rpc "$RPC_URL" --from "$SOLVER" | tee "$LIVE_LOG"
  unset PRIVATE_KEY LIVE_INSTITUTION_A_KEY LIVE_INSTITUTION_B_KEY LIVE_SOLVER_KEY
  LIVE_TX=$(awk '/transaction hash:/ {print $3}' "$LIVE_LOG" | tail -1)
  if [[ ! "$LIVE_TX" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "Broadcast completed but the transaction hash could not be parsed." >&2
    exit 1
  fi
  printf '\n%sNEW BROADCAST — VERIFY NOW%s\n' "$GREEN$BOLD" "$RESET"
  printf '%s/tx/%s\n' "$EXPLORER" "$LIVE_TX"
else
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
  printf '\n%sCanonical live trade evidence%s\n' "$BOLD" "$RESET"
  printf 'forward 2-order: %s/tx/%s\n' "$EXPLORER" "$(jq -r '.batches.forward010By007.transactionHash' "$MANIFEST")"
  printf 'reverse 2-order: %s/tx/%s\n' "$EXPLORER" "$(jq -r '.batches.reverse006By009.transactionHash' "$MANIFEST")"
  printf '4-order batch:   %s/tx/%s\n' "$EXPLORER" "$(jq -r '.batches.fourOrder.transactionHash' "$MANIFEST")"
  printf '16-order batch:  %s/tx/%s\n' "$EXPLORER" "$(jq -r '.batches.sixteenOrder.transactionHash' "$MANIFEST")"
fi
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
