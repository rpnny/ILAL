#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_PORT="${ILAL_V2_FORK_PORT:-18545}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"
FORK_URL="${ILAL_FORK_URL:-https://sepolia.base.org}"
WALLET="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
UNAUTHORIZED_WALLET="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
RUN_DIR="${ILAL_V2_SIM_DIR:-$ROOT/artifacts/v2-fork-simulation}"
WALLET_LOWER="$(printf '%s' "$WALLET" | tr '[:upper:]' '[:lower:]')"
PROOF_DIR="$ROOT/artifacts/v2-demo/$WALLET_LOWER"
DEPLOYMENT_JSON="$PROOF_DIR/deployment.json"
CLI=(node "$ROOT/cli/dist/index.js")
ANVIL_LOG="$RUN_DIR/anvil.log"
TRANSCRIPT="$RUN_DIR/transcript.log"
export ILAL_DISABLE_EXPLORER=1

for command in anvil forge cast node npm; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

mkdir -p "$RUN_DIR"
: > "$TRANSCRIPT"

cleanup() {
  if [[ -n "${ANVIL_PID:-}" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

run() {
  printf '\n$' | tee -a "$TRANSCRIPT"
  printf ' %q' "$@" | tee -a "$TRANSCRIPT"
  printf '\n' | tee -a "$TRANSCRIPT"
  "$@" 2>&1 | tee -a "$TRANSCRIPT"
}

expect_failure() {
  local label="$1"
  shift
  printf '\n[EXPECTED FAILURE] %s\n' "$label" | tee -a "$TRANSCRIPT"
  set +e
  "$@" > "$RUN_DIR/expected-failure.log" 2>&1
  local status=$?
  set -e
  cat "$RUN_DIR/expected-failure.log" | tee -a "$TRANSCRIPT"
  if [[ $status -eq 0 ]]; then
    echo "ERROR: expected failure succeeded: $label" | tee -a "$TRANSCRIPT"
    exit 1
  fi
  echo "PASS: $label was rejected" | tee -a "$TRANSCRIPT"
}

echo "Starting Base Sepolia fork on $RPC_URL" | tee -a "$TRANSCRIPT"
anvil --fork-url "$FORK_URL" --chain-id 84532 --port "$RPC_PORT" --silent > "$ANVIL_LOG" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 40); do
  if cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
cast block-number --rpc-url "$RPC_URL" >/dev/null

run npm run build --prefix "$ROOT/cli"
rm -f "$DEPLOYMENT_JSON"
run "${CLI[@]}" --rpc-account "$WALLET" deploy \
  --v2 --chain 84532 --rpc "$RPC_URL" --broadcast \
  --admin "$WALLET" --treasury "$WALLET" --wallet-to-seed "$WALLET" \
  --contracts-dir "$ROOT/contracts"

[[ -s "$DEPLOYMENT_JSON" ]] || { echo "Missing deployment JSON: $DEPLOYMENT_JSON" >&2; exit 1; }

node --input-type=module - "$DEPLOYMENT_JSON" "$RUN_DIR/.ilal.json" "$RPC_URL" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [source, target, rpc] = process.argv.slice(2);
const d = JSON.parse(readFileSync(source, "utf8"));
writeFileSync(target, JSON.stringify({
  protocolVersion: "2",
  chain: "84532",
  rpc,
  hook: d.hook,
  registry: d.registry,
  grantManager: d.grantManager,
  router: d.router,
  treasury: d.treasury,
  tokenA: d.tokenA,
  tokenB: d.tokenB,
  poolId: d.poolId,
  fee: String(d.fee),
  tickSpacing: String(d.tickSpacing),
  circuitDir: "circuits/build-v2"
}, null, 2) + "\n");
NODE

cd "$RUN_DIR"
run "${CLI[@]}" status --wallet "$WALLET"
run "${CLI[@]}" --rpc-account "$WALLET" policy grant activate \
  --proof "$PROOF_DIR/proof.json" --public "$PROOF_DIR/public.json"
run "${CLI[@]}" status --wallet "$WALLET"
run "${CLI[@]}" demo check --wallet "$WALLET"

run "${CLI[@]}" --rpc-account "$WALLET" pool add-liquidity \
  --tick-lower=-600 --tick-upper=600 --liquidity=1000000000000000000 \
  --max-amount-0=1000000000000000000000 --max-amount-1=1000000000000000000000

TOKEN_B="$(node -e 'console.log(require(process.argv[1]).tokenB)' "$RUN_DIR/.ilal.json")"
run "${CLI[@]}" --rpc-account "$WALLET" swap \
  --amount-in 0.001 --token-in "$TOKEN_B" --min-amount-out 1

expect_failure "unbound wallet cannot activate another wallet's proof" \
  "${CLI[@]}" --rpc-account "$UNAUTHORIZED_WALLET" policy grant activate \
  --proof "$PROOF_DIR/proof.json" --public "$PROOF_DIR/public.json"

expect_failure "wallet without a policy grant cannot swap" \
  "${CLI[@]}" --rpc-account "$UNAUTHORIZED_WALLET" swap \
  --amount-in 0.001 --token-in "$TOKEN_B" --min-amount-out 1

ISSUER_HASH="$(node -e 'console.log(require(process.argv[1]).issuerHash)' "$DEPLOYMENT_JSON")"
SCHEMA_HASH="$(node -e 'console.log(require(process.argv[1]).schemaHash)' "$DEPLOYMENT_JSON")"
CREDENTIAL_ROOT="$(node -e 'console.log(require(process.argv[1]).credentialRoot)' "$DEPLOYMENT_JSON")"
MIN_KYC_LEVEL="$(node -e 'console.log(require(process.argv[1]).minKycLevel)' "$DEPLOYMENT_JSON")"
JURISDICTION_ROOT="$(node -e 'console.log(require(process.argv[1]).jurisdictionRoot)' "$DEPLOYMENT_JSON")"
POLICY_HASH="$(node -e 'console.log(require(process.argv[1]).policyHash)' "$DEPLOYMENT_JSON")"
MAX_GRANT_TTL="$(node -e 'console.log(require(process.argv[1]).maxGrantTTL)' "$DEPLOYMENT_JSON")"

run "${CLI[@]}" --rpc-account "$WALLET" policy admin set \
  --issuer-hash "$ISSUER_HASH" --schema-hash "$SCHEMA_HASH" \
  --credential-root "$CREDENTIAL_ROOT" --min-kyc-level "$MIN_KYC_LEVEL" \
  --jurisdiction-root "$JURISDICTION_ROOT" --policy-hash "$POLICY_HASH" \
  --max-grant-ttl "$MAX_GRANT_TTL"

expect_failure "policy revision invalidates a previously cached grant" \
  "${CLI[@]}" --rpc-account "$WALLET" swap \
  --amount-in 0.001 --token-in "$TOKEN_B" --min-amount-out 1

run "${CLI[@]}" --rpc-account "$WALLET" policy grant activate \
  --proof "$PROOF_DIR/proof.json" --public "$PROOF_DIR/public.json"

run "${CLI[@]}" --rpc-account "$WALLET" policy grant revoke --wallet "$WALLET"
expect_failure "revoked grant cannot swap" \
  "${CLI[@]}" --rpc-account "$WALLET" swap \
  --amount-in 0.001 --token-in "$TOKEN_B" --min-amount-out 1

node --input-type=module - "$DEPLOYMENT_JSON" "$RUN_DIR/result.json" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const [deploymentPath, resultPath] = process.argv.slice(2);
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
writeFileSync(resultPath, JSON.stringify({
  status: "PASS",
  environment: "local Base Sepolia fork; no public-chain broadcast",
  deployment,
  checks: {
    proofGeneratedAndVerified: true,
    policyGrantActivated: true,
    liquidityAdded: true,
    swapExecuted: true,
    foreignProofRejected: true,
    missingGrantRejected: true,
    policyRevisionInvalidatedGrant: true,
    policyGrantReactivatedAtNewRevision: true,
    revokedGrantRejected: true
  }
}, null, 2) + "\n");
NODE

echo
echo "ILAL v2 fork simulation PASS"
echo "Transcript: $TRANSCRIPT"
echo "Result:     $RUN_DIR/result.json"
