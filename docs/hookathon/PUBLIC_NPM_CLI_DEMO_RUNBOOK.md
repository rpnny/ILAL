# ILAL public npm CLI demo runbook

This runbook uses only the published npm preview package:

```text
@ilalv3/cli@0.4.0-v2-poc.7
```

The commands below are intended for Base Sepolia test wallets only. Never type a
private key directly into a command or save it in this document. Signed order
JSON files contain no private key.

## 中文使用说明

- A、B 两节在录屏前完成：安装公开 npm CLI、创建临时目录、静默输入测试密钥并生成订单。
- C 到 F 是正式录屏内容：展示版本、preview、preflight、execute 和新的 BaseScan 链接。
- `preflight` 只有在 `status: executable` 且 `oracle.status: valid` 时才能继续广播。
- 如果出现 `CHAINLINK_STALE_PRICE` 或任何 rejection，立即停止，不修改 Guard、不故意发送 reverting transaction。
- 所有私钥只通过终端静默输入；不要粘贴到命令、文档、录屏或聊天中。

## What the reviewer will see

1. A public npm package and exact version.
2. Two freshly signed opposing orders.
3. A deterministic offline batch commitment.
4. A pinned-state preflight that checks Chainlink, signatures, policy, nonce,
   balances, allowances and the complete `eth_call` execution.
5. A permissionless Base Sepolia broadcast.
6. A new transaction hash and BaseScan URL.

## Candidate constants

```bash
export ILAL_VERSION=0.4.0-v2-poc.7
export ILAL_RPC=https://sepolia.base.org
export ILAL_HOOK=0x8d1fA43F848701b2adB105D5c925A9247E600088
export ILAL_ROUTER=0x96456C68f25A1Fa6C2F2751183401ac26A732506
export ILAL_USDC=0x036CbD53842c5426634e7929541eC2318f3dCF7e
export ILAL_HUSDT=0xC4946fEC334f4B9350dF08E311261e4361B7c72C
export ILAL_POOL=0xeab91a1421cb5c170df74c1eaf676a8836eda1fc5a833f62ab9c2d516acfbc87
export ILAL_INSTITUTION_A=0x1b869CaC69Df23Ad9D727932496AEb3605538c8D
export ILAL_INSTITUTION_B=0xC61d6115fcFcbA97Bd44Cb013C877bD0ef868dB3
export ILAL_EXECUTOR=0x58B24A10593a50a83E9F74bB1Ff3F98421288797
```

## A. One-time public CLI setup

Run before recording:

```bash
npm view @ilalv3/cli@0.4.0-v2-poc.7 version
npm install -g @ilalv3/cli@0.4.0-v2-poc.7
rehash
which ilal
ilal --version
ilal netting --help
```

The version must be exactly:

```text
0.4.0-v2-poc.7
```

If the global shell still resolves `0.3.3`, use the public package without a
global install:

```bash
npm exec --yes --package=@ilalv3/cli@0.4.0-v2-poc.7 -- ilal netting --help
```

## B. Off-camera preparation

Create a temporary workspace. It is removed when the terminal closes or when
you delete it; it contains signed orders but no private key.

```bash
umask 077
export ILAL_DEMO_DIR=$(mktemp -d /tmp/ilal-public-cli-demo.XXXXXX)
echo "$ILAL_DEMO_DIR"
```

Enter the Institution B test key silently. Institution B supplies `0.010 USDC`.

```bash
read -s "PRIVATE_KEY?Institution B test key: "
echo
export PRIVATE_KEY
ilal --unsafe-private-key netting order sign \
  --zero-for-one \
  --amount-in 10000 \
  --min-amount-out 9800 \
  --max-amm-input 3000 \
  --pool "$ILAL_POOL" \
  --hook "$ILAL_HOOK" \
  --chain 84532 \
  --ttl 3600 \
  --output "$ILAL_DEMO_DIR/order-usdc.json"
unset PRIVATE_KEY
```

Enter the Institution A test key silently. Institution A supplies
`0.007 hUSDT`.

```bash
read -s "PRIVATE_KEY?Institution A test key: "
echo
export PRIVATE_KEY
ilal --unsafe-private-key netting order sign \
  --one-for-zero \
  --amount-in 7000 \
  --min-amount-out 7000 \
  --max-amm-input 0 \
  --pool "$ILAL_POOL" \
  --hook "$ILAL_HOOK" \
  --chain 84532 \
  --ttl 3600 \
  --output "$ILAL_DEMO_DIR/order-husdt.json"
unset PRIVATE_KEY
```

Prepare the executor key without putting it in shell history:

```bash
read -s "ILAL_EXECUTOR_KEY?Executor test key: "
echo
export ILAL_EXECUTOR_KEY
```

Confirm that the order files contain the expected public users:

```bash
jq -r '.order.user' "$ILAL_DEMO_DIR/order-usdc.json"
jq -r '.order.user' "$ILAL_DEMO_DIR/order-husdt.json"
```

Expected order:

```text
0xC61d6115fcFcbA97Bd44Cb013C877bD0ef868dB3
0x1b869CaC69Df23Ad9D727932496AEb3605538c8D
```

Stop here and start recording.

## C. On-camera command 1 — public package identity

Say: “This is the published npm preview, not a local wrapper.”

```bash
ilal --version
```

Expected:

```text
0.4.0-v2-poc.7
```

## D. On-camera command 2 — deterministic batch preview

```bash
ilal netting batch preview \
  --orders "$ILAL_DEMO_DIR/order-usdc.json" "$ILAL_DEMO_DIR/order-husdt.json"
```

Point to:

```text
submitted gross:          17000
internally matched gross: 14000
matched each side:        7000
residual token0:          3000
residual token1:          0
```

Explain that this is offline arithmetic and commitment generation. It does not
broadcast a transaction.

## E. On-camera command 3 — pinned Chainlink-aware preflight

```bash
ilal netting batch preflight \
  --orders "$ILAL_DEMO_DIR/order-usdc.json" "$ILAL_DEMO_DIR/order-husdt.json" \
  --router "$ILAL_ROUTER" \
  --hook "$ILAL_HOOK" \
  --token-a "$ILAL_USDC" \
  --token-b "$ILAL_HUSDT" \
  --fee 500 \
  --tick-spacing 10 \
  --chain 84532 \
  --rpc "$ILAL_RPC" \
  --from "$ILAL_EXECUTOR" \
  --output "$ILAL_DEMO_DIR/preflight.json"
```

Inspect the machine-readable result:

```bash
jq '{status,snapshot,batch,oracle,fees,decodedRevert}' \
  "$ILAL_DEMO_DIR/preflight.json"
```

The only acceptable broadcast condition is:

```text
status: executable
oracle.status: valid
```

If the command returns exit code `2` or reports `CHAINLINK_STALE_PRICE`,
`CHAINLINK_PEG_DEVIATION` or any other rejection, stop. Do not execute the next
command and do not loosen the Guard for the recording. A rejection proves the
fail-closed boundary but is not a successful trade demo.

## F. On-camera command 4 — live Base Sepolia broadcast

Run only after preflight reports `executable`:

```bash
PRIVATE_KEY="$ILAL_EXECUTOR_KEY" ilal --unsafe-private-key netting batch execute \
  --orders "$ILAL_DEMO_DIR/order-usdc.json" "$ILAL_DEMO_DIR/order-husdt.json" \
  --router "$ILAL_ROUTER" \
  --hook "$ILAL_HOOK" \
  --token-a "$ILAL_USDC" \
  --token-b "$ILAL_HUSDT" \
  --fee 500 \
  --tick-spacing 10 \
  --chain 84532 \
  --rpc "$ILAL_RPC" \
  --from "$ILAL_EXECUTOR" | tee "$ILAL_DEMO_DIR/execute.log"
```

`execute` performs an initial signer-free preflight, accesses the executor only
after it passes, repeats the full simulation immediately before broadcast and
waits for a successful receipt.

Extract and open the new transaction:

```bash
export ILAL_TX=$(awk '/transaction hash:/ {print $3}' \
  "$ILAL_DEMO_DIR/execute.log" | tail -1)
echo "https://sepolia.basescan.org/tx/$ILAL_TX"
open "https://sepolia.basescan.org/tx/$ILAL_TX"
```

## G. On-camera evidence links if live broadcast is unavailable

These are already-broadcast Base Sepolia transactions, not simulations:

```text
2-order forward
https://sepolia.basescan.org/tx/0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998

2-order reverse
https://sepolia.basescan.org/tx/0x588ac879d9287435e04af158acf4b491f77baa2cdfe6e6729eab16ecf46f5172

4-order batch
https://sepolia.basescan.org/tx/0xf6d74bd973b6c26c63ec7317dff87ba8055d8946eb2b637791b5376e1d335954

16-order batch
https://sepolia.basescan.org/tx/0x883560276318337104db9020513ec685bb8ae672a3678f77d682f885093f40b7
```

Do not describe a historical transaction as a transaction broadcast during the
recording.

## H. Cleanup

```bash
unset PRIVATE_KEY ILAL_EXECUTOR_KEY
case "$ILAL_DEMO_DIR" in
  /tmp/ilal-public-cli-demo.*) rm -rf -- "$ILAL_DEMO_DIR" ;;
  *) echo "Refusing to remove unexpected path: $ILAL_DEMO_DIR" ;;
esac
unset ILAL_DEMO_DIR ILAL_TX
```

The cleanup target is the explicit temporary directory created in section B.
