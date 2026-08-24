# ILAL 机构验证实验前基线

冻结日期：2026-08-24
基线提交：`93b41c3`
状态：Hookathon candidate；具备 institutional pilot candidate 的技术基础；未经独立审计，不是 production-ready。

## 当前架构与发布面

ILAL 的 Hookathon 路径由 `InstitutionalNettingHook` 与 permissionless
`InstitutionalBatchRouter` 组成。2–16 个已签名、当前合规的等精度稳定币订单在一个
`PoolManager.unlock` 内按 canonical order hash 分配，内部按 raw-unit 1:1 结算，仅将净残差送入
Uniswap v4。现有 candidate 固定支持 0.05% fee、tick spacing 10、batch 起点 ±100 tick guard。

CLI preview `@ilalv3/cli@0.4.0-v2-poc.5` 与 SDK
`@ilalv3/sdk@0.3.0-next.1` 已发布在 npm `next`；stable `latest` 尚未包含 netting/V2。

## 已有验证证据

- 242 个 Foundry 测试、53 个 CLI 测试、18 个 SDK 测试，以及 6 个 netting invariants × 256 calls。
- Base Sepolia candidate Hook：`0xb385043E7489E2683473a0158710e3F9932F4088`。
- Forward 100/70 batch：`0x4dc0493ea84caeef1dc4f4e8ce4ed3598cd23985ba64f58fbde0ee0c67d6dfa9`。
- Reverse 60/90 batch：`0x4e4e2d6a45c76596a032d7fd09244420f00d56a033fb75f1137bba5f02f82fd8`。
- Sourcify exact-match、部署 manifest、正反残差与零 Hook/Router 库存均已记录。

## 已完成实验与暂定结论

现有 Foundry benchmark 验证 25/50/70/90/100% opposing flow；notional sweep 验证
100/1k/10k/100k 的 fixed/scaled liquidity。100/70 场景显示 140 gross 内部匹配、30 residual
进入 AMM。scaled-liquidity 结果测得约 7 bps/anchor 的输出改善，但 gas 比 direct-v4 fixture 更高。

这些结果只证明机制与受控环境下的潜在经济性，尚不能证明 Base 生产费用下的机构 ROI。

## 已知限制

- vanilla baseline 是 Foundry direct router，不是官方 Universal Router + Permit2。
- 两种资产均为 6 decimals、$1 假设、raw-unit 1:1 mock stablecoins。
- candidate 只支持 5 bps pool fee；其他 fee tiers 属于明确的 unsupported configuration。
- 100k/70k fixed-liquidity 已知 capacity-limited。
- 旧成本模型未计 Base L1 security fee，也未预留 solver/operator 成本。
- CLI preview 仅做离线算术；基线时没有 signer-free 的链上 preflight。
- RWA issuer 流程有功能测试，但没有 100k 记录、内存、proof p95 与 TCO 研究。

## 本轮假设与门槛

本轮研究采用 `institutional-study-v1`、固定 seed、固定 fork block 与机器生成报告。严格门槛包括：
零 P0/P1；支持域内 preflight/execute 100% 一致；$10k/70%/5bps/scaled 场景在 Base L1+L2、
ETH $3k、1 gwei 与 0.5 bps solver reserve 后优于最低成本 full-fill vanilla；100k PII-free
issuer journey ≤10 分钟、RSS ≤4 GiB、20 proof runs p95 ≤30 秒。

任何未测项都记为 `NOT_RUN`，任何缺少 production-fee 数据的经济结论都不得记为 PASS。
