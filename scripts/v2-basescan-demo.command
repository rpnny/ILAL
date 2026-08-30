#!/bin/bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="${ILAL_BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
CLI_VERSION="${ILAL_CLI_VERSION:-0.4.0-v2-poc.7}"
CLI=(npm exec --yes --package="@ilalv3/cli@${CLI_VERSION}" -- ilal)
EXPLORER="https://sepolia.basescan.org"

cd "$ROOT"

for command in npm node forge cast jq; do
  command -v "$command" >/dev/null || {
    echo "Missing required command: $command" >&2
    exit 1
  }
done

echo
echo "ILAL V2 — PUBLIC BASE SEPOLIA / BASESCAN DEMO"
echo "This broadcasts a fresh test-only V2 stack, grant, liquidity add and swap."
echo "CLI: @ilalv3/cli@${CLI_VERSION}"
echo "RPC: ${RPC_URL}"
echo

read -r -p "Wallet address: " WALLET
if ! [[ "$WALLET" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Invalid wallet address." >&2
  exit 1
fi

read -r -s -p "Base Sepolia test private key (hidden): " PRIVATE_KEY
echo
export PRIVATE_KEY

cleanup() {
  unset PRIVATE_KEY
}
trap cleanup EXIT

DERIVED_WALLET="$(cast wallet address --private-key "$PRIVATE_KEY")"
DERIVED_WALLET_LOWER="$(printf '%s' "$DERIVED_WALLET" | tr '[:upper:]' '[:lower:]')"
WALLET_LOWER="$(printf '%s' "$WALLET" | tr '[:upper:]' '[:lower:]')"
if [[ "$DERIVED_WALLET_LOWER" != "$WALLET_LOWER" ]]; then
  echo "The private key does not match ${WALLET}. Nothing was broadcast." >&2
  exit 1
fi

BALANCE_WEI="$(cast balance "$WALLET" --rpc-url "$RPC_URL")"
echo "Wallet:  $WALLET"
echo "Balance: $(cast from-wei "$BALANCE_WEI") ETH"
if (( BALANCE_WEI < 5000000000000000 )); then
  echo "At least 0.005 Base Sepolia ETH is required for this full demo." >&2
  exit 1
fi

PROOF_DIR="$ROOT/artifacts/v2-demo/$WALLET_LOWER"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_DIR="$ROOT/artifacts/v2-public-demo/$WALLET_LOWER/$STAMP"
mkdir -p "$RUN_DIR"

if [[ -d "$PROOF_DIR" ]]; then
  echo "Backing up existing wallet artifacts to $RUN_DIR/previous-v2-demo"
  cp -R "$PROOF_DIR" "$RUN_DIR/previous-v2-demo"
fi

echo
read -r -p "Type BROADCAST to deploy and transact on Base Sepolia: " CONFIRM
if [[ "$CONFIRM" != "BROADCAST" ]]; then
  echo "Cancelled. Nothing was broadcast."
  exit 0
fi

echo
echo "[1/5] Deploying fresh V2 contracts, tokens, Hook and pool..."
"${CLI[@]}" --unsafe-private-key deploy \
  --v2 \
  --chain 84532 \
  --rpc "$RPC_URL" \
  --broadcast \
  --admin "$WALLET" \
  --treasury "$WALLET" \
  --wallet-to-seed "$WALLET" \
  --contracts-dir "$ROOT/contracts" \
  2>&1 | tee "$RUN_DIR/01-deploy.log"

DEPLOYMENT_JSON="$PROOF_DIR/deployment.json"
PROOF_JSON="$PROOF_DIR/proof.json"
PUBLIC_JSON="$PROOF_DIR/public.json"
for file in "$DEPLOYMENT_JSON" "$PROOF_JSON" "$PUBLIC_JSON"; do
  [[ -s "$file" ]] || {
    echo "Deployment did not produce $file" >&2
    exit 1
  }
done

cp "$DEPLOYMENT_JSON" "$PROOF_JSON" "$PUBLIC_JSON" "$RUN_DIR/"

jq --arg rpc "$RPC_URL" '{
  protocolVersion: "2",
  chain: (.chainId | tostring),
  rpc: $rpc,
  hook,
  registry,
  grantManager,
  router,
  treasury,
  tokenA,
  tokenB,
  poolId,
  fee: (.fee | tostring),
  tickSpacing: (.tickSpacing | tostring),
  circuitDir: "circuits/build-v2"
}' "$DEPLOYMENT_JSON" > "$RUN_DIR/.ilal.json"

cd "$RUN_DIR"

echo
echo "[2/5] Activating the wallet-bound policy grant..."
"${CLI[@]}" --unsafe-private-key policy grant activate \
  --proof "$PROOF_JSON" \
  --public "$PUBLIC_JSON" \
  2>&1 | tee "$RUN_DIR/02-grant.log"

echo
echo "[3/5] Confirming grant and seeded test-token balances..."
"${CLI[@]}" demo check --wallet "$WALLET" 2>&1 | tee "$RUN_DIR/03-check.log"

echo
echo "[4/5] Adding liquidity..."
"${CLI[@]}" --unsafe-private-key pool add-liquidity \
  --tick-lower=-600 \
  --tick-upper=600 \
  --liquidity=1000000000000000000 \
  --max-amount-0=1000000000000000000000 \
  --max-amount-1=1000000000000000000000 \
  2>&1 | tee "$RUN_DIR/04-add-liquidity.log"

TOKEN_IN="$(jq -r '.tokenB' "$DEPLOYMENT_JSON")"

echo
echo "[5/5] Executing a small exact-input swap..."
"${CLI[@]}" --unsafe-private-key swap \
  --amount-in 0.001 \
  --token-in "$TOKEN_IN" \
  --min-amount-out 1 \
  --explain \
  2>&1 | tee "$RUN_DIR/05-swap.log"

strip_ansi() {
  sed $'s/\033\[[0-9;]*m//g' "$1"
}

last_hash() {
  strip_ansi "$1" | grep -Eo '0x[0-9a-fA-F]{64}' | tail -n 1
}

GRANT_TX="$(last_hash "$RUN_DIR/02-grant.log")"
LIQUIDITY_TX="$(last_hash "$RUN_DIR/04-add-liquidity.log")"
SWAP_TX="$(last_hash "$RUN_DIR/05-swap.log")"

BROADCAST_JSON="$ROOT/contracts/broadcast/DeployV2Demo.s.sol/84532/run-latest.json"
if [[ -s "$BROADCAST_JSON" ]]; then
  jq -r '.transactions[]?.hash // empty' "$BROADCAST_JSON" | awk '!seen[$0]++' > "$RUN_DIR/deployment-transactions.txt"
else
  : > "$RUN_DIR/deployment-transactions.txt"
fi

{
  echo "ILAL V2 Base Sepolia evidence"
  echo "Run: $STAMP"
  echo "Wallet: $WALLET"
  echo "Deployment manifest: $DEPLOYMENT_JSON"
  echo
  echo "Deployment transactions:"
  while IFS= read -r hash; do
    [[ -n "$hash" ]] && echo "$EXPLORER/tx/$hash"
  done < "$RUN_DIR/deployment-transactions.txt"
  echo
  echo "Grant:         $EXPLORER/tx/$GRANT_TX"
  echo "Add liquidity: $EXPLORER/tx/$LIQUIDITY_TX"
  echo "Swap:          $EXPLORER/tx/$SWAP_TX"
  echo
  echo "Contracts:"
  for key in registry grantManager router hook tokenA tokenB; do
    address="$(jq -r ".${key}" "$DEPLOYMENT_JSON")"
    echo "$key: $EXPLORER/address/$address"
  done
} | tee "$RUN_DIR/BASESCAN_EVIDENCE.txt"

echo
echo "PUBLIC BASE SEPOLIA DEMO COMPLETE"
echo "Evidence: $RUN_DIR/BASESCAN_EVIDENCE.txt"
echo "The generated proof input and keys must remain private."
