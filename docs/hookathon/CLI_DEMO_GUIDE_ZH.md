# ILAL UHI Pitch：手动 CLI 演示操作文档

这是一份演讲时放在旁边照着操作的提词文档。你自己打开 Terminal，
逐段复制命令并讲解；不需要运行自动演示脚本。

演示由三类证据组成，必须准确区分：

1. **实时本地操作**：生成临时签名订单、运行 ILAL CLI preview。
2. **实时只读链上查询**：读取 Chainlink Guard 和历史交易 receipt。
3. **固定候选证据**：展示当时的 pinned preflight 与 postconditions，不冒充新交易。

整段 CLI 演示目标为 **1 分 45 秒至 2 分 15 秒**。视频其余时间用于问题、
架构、impact 和结尾。

## 0. 录制前准备

打开 macOS Terminal，放大字体，建议窗口宽度至少 120 columns。然后执行：

```bash
cd /Users/ronny/ilal
npm --prefix cli run build
export ILAL_PITCH_TMP=$(mktemp -d "${TMPDIR:-/tmp}/ilal-pitch-manual.XXXXXX")
export ILAL_PITCH_RPC=https://sepolia.base.org
clear
```

确认版本：

```bash
node cli/dist/index.js --version
```

预期看到：

```text
0.4.0-v2-poc.7
```

这一段不需要录入视频。正式录制从第 1 节开始。

## 1. 生成两个真实签名订单

以下 key 是运行时随机生成的临时测试签名者，只存在当前 shell 环境，不写入
仓库，也不用于链上资金。

```bash
export ILAL_PITCH_KEY_A=0x$(openssl rand -hex 32)
export ILAL_PITCH_KEY_B=0x$(openssl rand -hex 32)
```

签署 token0 → token1 的 100-unit order：

```bash
PRIVATE_KEY="$ILAL_PITCH_KEY_A" node cli/dist/index.js --unsafe-private-key \
  netting order sign \
  --zero-for-one \
  --amount-in 100000000 \
  --min-amount-out 99000000 \
  --max-amm-input 30000000 \
  --pool 0x2222222222222222222222222222222222222222222222222222222222222222 \
  --hook 0x1111111111111111111111111111111111111111 \
  --chain 84532 \
  --deadline 4000000000 \
  --nonce 0x0000000000000000000000000000000000000000000000000000000000000001 \
  --output "$ILAL_PITCH_TMP/order-a.json"
```

签署 token1 → token0 的 70-unit order：

```bash
PRIVATE_KEY="$ILAL_PITCH_KEY_B" node cli/dist/index.js --unsafe-private-key \
  netting order sign \
  --one-for-zero \
  --amount-in 70000000 \
  --min-amount-out 70000000 \
  --max-amm-input 0 \
  --pool 0x2222222222222222222222222222222222222222222222222222222222222222 \
  --hook 0x1111111111111111111111111111111111111111 \
  --chain 84532 \
  --deadline 4000000000 \
  --nonce 0x0000000000000000000000000000000000000000000000000000000000000002 \
  --output "$ILAL_PITCH_TMP/order-b.json"
```

立刻移除 shell 中的临时 key：

```bash
unset ILAL_PITCH_KEY_A ILAL_PITCH_KEY_B PRIVATE_KEY
```

你此时讲：

> Each institution signs its own bounded exact-input order. The solver never
> receives a private key—only the signed order file.

建议录屏时保留第二个订单的 `orderHash` 输出，然后进入下一步。

## 2. 用真实 ILAL CLI 计算 `100 / 70`

```bash
node cli/dist/index.js netting batch preview \
  --orders "$ILAL_PITCH_TMP/order-a.json" "$ILAL_PITCH_TMP/order-b.json"
```

预期核心输出：

```text
ordering:                 orderHash ascending
submitted gross:          170000000
internally matched gross: 140000000
matched each side:        70000000
residual token0:          30000000
residual token1:          0
```

你此时讲：

> The CLI canonicalizes allocation by order hash. From 170 million submitted
> raw units, 140 million are internally matched. Only 30 million remain for
> the AMM.

注意：这一步是实时的真实 CLI batch arithmetic 和 commitment。它不是链上签名
验证；签名、policy、nonce、余额和完整执行由后面的 onchain preflight 验证。

## 3. 实时读取 Chainlink Guard

这一步直接读取当前 Base Sepolia Guard，不使用私钥：

```bash
cast call 0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3 \
  'validate()((uint256,uint256,uint256,uint256,bool))' \
  --rpc-url "$ILAL_PITCH_RPC"
```

正常情况下会得到类似：

```text
(1000000000000000000, 999940000000000000, ..., ..., false)
```

前两个数字是标准化到 18 decimals 的 USDC/USD 与 USDT/USD。最后的 `false`
表示 Base Sepolia candidate 未启用 sequencer uptime feed。

你此时讲：

> Before nonce consumption or asset movement, the Hook checks two external
> Chainlink dollar feeds and then the Uniswap pool tick. Chainlink is a circuit
> breaker, not the execution price.

如果公共 RPC 当时不可用，不要现场修复网络；跳过本节，直接展示第 4 节的固定
manifest 证据。

## 4. 展示 pinned preflight

这是最终 candidate 在广播前保存的状态快照：

```bash
jq '.batches.forward010By007.preflight' \
  docs/hookathon/chainlink-candidate-manifest.json
```

预期输出：

```json
{
  "blockNumber": 45934560,
  "blockHash": "0x2f2453d03672608937f95dcbb9a969da55ca9a459014f3f7c7d00b3e0ee7dedb",
  "status": "executable",
  "estimatedGas": 828310
}
```

你此时讲：

> This pinned snapshot passed signatures, deadlines, nonces, policy, balances,
> allowances, Chainlink, pool state and a complete eth_call simulation before
> broadcast.

必须称它为 **recorded pinned preflight evidence**，不要说这是刚刚重新执行的
preflight。

## 5. 实时查询 Base Sepolia transaction receipt

```bash
cast receipt \
  0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998 \
  --rpc-url "$ILAL_PITCH_RPC" | \
  awk '/^(blockNumber|gasUsed|status|transactionHash)[[:space:]]/{print}'
```

预期输出：

```text
blockNumber          45934588
gasUsed              640837
status               1 (success)
transactionHash      0x91770c...0998
```

再展示结算后状态：

```bash
jq '.batches.forward010By007, .postconditions, .sourceVerification.status' \
  docs/hookathon/chainlink-candidate-manifest.json
```

你此时讲：

> The batch settled on Base Sepolia. Fourteen hundredths were internally
> matched, three hundredths reached the AMM, and both the Hook and Router ended
> with zero inventory. The deployed source is an exact match.

交易链接：

<https://sepolia.basescan.org/tx/0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998>

## 6. 运行真实 oracle 原子回滚测试

```bash
forge test --root contracts \
  --match-path test/InstitutionalNetting.t.sol \
  --match-test test_oracleRejectionHappensBeforeNonceOrAssetMutation \
  -vv
```

预期结果：`1 passed; 0 failed`。

这个测试实际验证：

- Chainlink peg deviation 导致 batch revert；
- 用户余额不变；
- 两个 nonce 都未使用；
- batch context 关闭；
- Hook token inventory 为零。

你此时讲：

> Now the stablecoin moves outside the oracle boundary. The batch fails before
> balance or nonce mutation. No partial settlement, and no optimistic reading
> of a depeg.

## 7. 展示 impact

```bash
jq -r '
  .rows[] | select(.pair == "100/70") |
  "AMM exposure reduction: \(((.ammExposureReductionBps / 100 * 100 | round) / 100))%",
  "aggregate output gain:  \(.outputAdvantageBps) bps",
  "execution gas multiple: \(.executionGasMultiple)x"
' docs/hookathon/benchmark-results.json
```

```bash
jq -r '
  .gates[] | select(.id == "production-economic-gate") |
  "baseline:     \(.baseline)",
  "net benefit:  $\(((.netBenefitUsd * 100000 | round) / 100000))",
  "verdict:      \(.status)"
' docs/research/results/fork-study.json
```

预期核心结果：

```text
AMM exposure reduction: 82.35%
aggregate output gain:  4.1197 bps
execution gas multiple: 3.57x
net benefit:            $4.64345
verdict:                PASS
```

你此时讲：

> ILAL is not economical for every batch. Under the strict ten-thousand-dollar
> Base anchor, after execution cost, L1 security fee and solver reserve, the net
> benefit remains four dollars and sixty-four cents. When ILAL should not
> execute, preflight says no.

## 8. 结束

最后不要再输入命令。看向镜头并说：

> Public liquidity should absorb imbalance—not unnecessary gross flow.
> Verify access. Net what cancels. Send only the residual to Uniswap.

## 录制前检查表

- Terminal 字号至少 18–20 pt。
- 关闭通知、聊天软件和包含敏感信息的其他窗口。
- 不显示 shell history，不运行 `env`，不使用真实钱包密钥。
- 第 3、5 节依赖只读公共 RPC；正式视频优先使用一次完整成功录制。
- CLI 演示控制在约两分钟，整个视频控制在 4:20–4:40。
- 所有旁白必须由真人录制，不能使用 AI voice。

## 演示后清理

```bash
rm "$ILAL_PITCH_TMP/order-a.json" "$ILAL_PITCH_TMP/order-b.json"
rmdir "$ILAL_PITCH_TMP"
unset ILAL_PITCH_TMP ILAL_PITCH_RPC
```
