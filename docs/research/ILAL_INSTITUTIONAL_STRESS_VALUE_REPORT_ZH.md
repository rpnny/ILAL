# ILAL 机构压力测试与价值评估报告

## 1. Executive verdict

**PASS — ready for institutional pilot。** 独立审计前不得称为 production-ready。

本轮生成 160 个经济矩阵行，其中 40 个 5 bps 支持域场景由 Foundry 实测；1/30/100 bps 被明确标记为 candidate 不支持，而不是外推成结果。官方 Base Universal Router + Permit2 在固定 finalized block 50394803 上以真实 USDC/USDT bytecode 完成独立与 bundled 路径。

严格 $10k/70%/5bps/scaled 门槛的保守净收益为 **$4.748**，比较基线为 universal-router-bundled，已扣除 1 gwei L2 gas premium、完整 candidate L1 security fee 与 0.5 bps solver reserve。

## 2. 研究问题与假设

研究稳定币执行台的 notional、matching ratio、liquidity 与链上成本边界；验证 RWA issuer 的 PII-free 数据、加密存储、root/witness/proof 与 churn；验证守恒、原子性、授权、nonce、库存及 solver preflight。

## 3. 测试环境与可重复方法

- Schema：institutional-study-v1；固定 seed：0x494c414c2d494e535449545554494f4e414c2d53545544592d5631
- Local：Foundry forge Version: 1.5.1-stable
- Base fork：chain 8453，finalized block 50394803
- 命令：make study-local / study-fork / study-rwa / study-report / study-full
- 所有官网数字由机器结果生成，不手工复制。

## 4. 安全与原子性结果

Stateful handler calls：100000；每项 fuzz：10000。覆盖 peg tick ±99/±100/±101、allowance/balance 状态竞争、deadline、revocation、policy rotation、permissionless malicious executor、nonce rollback 与 canonical ordering。

## 5. Profitability heatmap

见 [profitability-heatmap.svg](charts/profitability-heatmap.svg)。非 5 bps 行是 unsupported configuration。生产门槛只对 $10k/70%/5bps/scaled 作 PASS/FAIL。

## 6. Capacity frontier

固定 candidate 深度中共有 5 个实测容量失败行；100k/70k 回归继续原子回滚。完整 5×3×3×3 二分 frontier 已完成 135 行，安全上限从 $257 到 $1000000。见 [capacity-frontier.svg](charts/capacity-frontier.svg)。

## 7. Multi-order scalability

完成 12 个场景（2/4/8/16 × uniform/one-large-many-small/long-tail）。16-order uniform total gas 为 1787349，rounding dust 为 0，canonical commitment 对 permutation 稳定。

## 8. Base production-fee benchmark

Base fee 同时计 L2 execution 与 L1 security。candidate 代表交易的 L1 fee 由 GasPriceOracle.getL1Fee 对完整历史序列化交易测得；Universal Router V2.1.1 与 Permit2 baseline 在官方 PoolManager 上执行。

## 9. RWA issuer workflow

最大数据集：100000 wallets；总耗时 483.83 秒；peak RSS 3.63 GiB；20-proof p95 3459.5 ms。数据仅含 wallet、KYC level、country、expiry、status 与 hashed source reference。

## 10. TCO sensitivity

TCO 只做 243 行参数模型：人员 $50/$100/$200 每小时、ETH $2k/$3k/$4k、L2 gas 0.01/0.1/1 gwei；分别列 issuer-paid、user-paid、system total。它不是客户 ROI 声明。

## 11. 失败案例与修复

- 修复 issuer 100k import 的 O(n²) wallet 查找，改为批次索引。
- 重复 wallet 从 silent overwrite 改为明确拒绝。
- 新增 signer-free pinned-block preflight 与 execute 前双重模拟。
- candidate 固定 fee surface 和非标准 ERC-20 限制写入 supported envelope。

## 12. Supported operating envelope

支持：2–16 orders、等 decimals 标准 ERC-20 stablecoins、raw-unit 1:1、5 bps、tick spacing 10、batch-start ±100 tick。Fee-on-transfer、rebasing、callback/nonstandard tokens、其他 fee tier、超出流动性/物理余额的 batch 不支持。

## 13. PASS / CONDITIONAL / FAIL

| Study | Gate | Status | Note |
|---|---|---|---|
| local | core-matrix-count | PASS |  |
| local | known-fixed-depth-regression | PASS |  |
| local | anchor-local-economics | PASS | Local-only signal; production gate remains pending L1 fee and official router baselines. |
| local | preflight-execution-consistency | PASS | Each frontier verdict is the same complete execution call used by eth_call preflight at one state snapshot. |
| local | production-economic-gate | NOT_RUN | Delegated to pinned Base fork: PASS |
| fork | fork-code-surface | PASS |  |
| fork | official-universal-router-full-fill | PASS |  |
| fork | production-economic-gate | PASS |  |
| rwa | rwa-100k-total-time | PASS |  |
| rwa | rwa-100k-peak-rss | PASS |  |
| rwa | proof-p95 | PASS |  |
| local | stateful-handler-calls | PASS |  |
| local | fuzz-cases-per-property | PASS |  |
| local | adversarial-regressions | PASS |  |

## 14. Production blockers 与下一步

独立审计仍是 production blocker。Proof 峰值为 3.63 GiB，pilot 主机应提供超过 4 GiB 的实际可用内存与额外余量。若 capacity full frontier 或 100k issuer/proof 门槛未完成，则保持 CONDITIONAL；任何 P0/P1 或经济门槛失败则为 FAIL/NO-GO。
