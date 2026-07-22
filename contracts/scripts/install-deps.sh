#!/usr/bin/env bash
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONTRACTS_DIR"

forge install --no-git --shallow \
  v4-core=Uniswap/v4-core@v1.0.2 \
  v4-periphery=Uniswap/v4-periphery@v1.0.4 \
  forge-std=foundry-rs/forge-std@v1.16.1 \
  eas-contracts=ethereum-attestation-service/eas-contracts@v1.9.0 \
  openzeppelin-contracts=OpenZeppelin/openzeppelin-contracts@v5.6.1
