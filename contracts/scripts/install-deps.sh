#!/usr/bin/env bash
set -euo pipefail

CONTRACTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CONTRACTS_DIR"

forge install --no-git --shallow \
  v4-core=Uniswap/v4-core@rev=59d3ecf53afa9264a16bba0e38f4c5d2231f80bc \
  v4-periphery=Uniswap/v4-periphery@rev=3231810e39b8c4d569b9d66907fa4ef8cd2cec22 \
  forge-std=foundry-rs/forge-std@rev=620536fa5277db4e3fd46772d5cbc1ea0696fb43 \
  eas-contracts=ethereum-attestation-service/eas-contracts@rev=3683c3ec9383091eebd6f183e67b485e09a53dd7 \
  openzeppelin-contracts=OpenZeppelin/openzeppelin-contracts@rev=5fd1781b1454fd1ef8e722282f86f9293cacf256
