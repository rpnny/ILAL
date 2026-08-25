# ILAL 全量测试数据与证据报告

报告日期：2026-08-25  
当前仓库：`main` / `75b24209f6598e68986987021ca7b001092ce97c`  
最终合约候选源码：`a512e6996735ab83d088a80723d30e4f7bb897a9`  
研究数据 schema：`institutional-study-v1`

## 1. 结论

**总判定：PASS — ready for institutional pilot。**

这意味着 ILAL 已具备测试网机构试点证据，不代表 production-ready。独立安全审计、Base mainnet Sequencer Uptime Feed、正式资产与真实机构流量验证仍是生产门槛。

| 维度 | 结果 | 关键数据 |
|---|---|---|
| 合约与工具测试 | PASS | Foundry 282、CLI 56、SDK 18 |
| 电路 | PASS | oracle 8；v1 正例 1/1、反例 3/3；v2 正例 1/1、反例 4/4 |
| 安全压力 | PASS | 100,000 handler calls；每项 property 10,000 fuzz cases；0 invariant revert |
| 经济矩阵 | PASS / 有支持域限制 | 160 rows；40 个 5 bps 实测；35 full fill；5 capacity-limited；120 个其他 fee tier 明确不支持 |
| 严格经济门槛 | PASS | `$10k / 70% / 5bps` 对 bundled Universal Router 基线净收益 `$4.64345` |
| Capacity frontier | PASS | 135 个二分场景；最大安全 notional `$137–$1,000,000`，取决于深度、range、tick 与物理余额 |
| 多订单 | PASS | 2/4/8/16 orders × 3 distributions；12/12；dust 0；permutation stable |
| RWA issuer | PASS | 100k wallets 总耗时 541.33 秒；20 proofs p95 3.612 秒；峰值 3.57 GiB |
| Base Sepolia | PASS | 正向、反向、4-order、16-order 全部成功；Hook/Router 零库存 |
| 源码验证 | PASS | 7 个第一方合约 Sourcify creation/runtime exact match |
| Findings | PASS with documented limits | P0=0、P1=0；P2=3（2 fixed、1 documented）；P3=3（全部 fixed） |

## 2. 数据分层与 provenance

本报告区分三类证据：

1. **当前代码验证**：最新通过的公开 `main` GitHub CI 是 [`32818935845`](https://github.com/rpnny/ILAL/actions/runs/32818935845)，head `75b24209f6598e68986987021ca7b001092ce97c`，结论 `success`。它覆盖当前合约、CLI、SDK、电路、package、SBOM 与研究 PR gate。
2. **研究运行数据**：`local/fork/rwa/stress` JSON 的记录基线是 `2f2c58d4ddb0fe9f0cb507ed2371fd5db0100d47`，并明确记录 `dirty: true`。这些文件是本轮研究实现期间生成、随后提交的测量快照，不应表述为在当前 clean `main` 上重新计时所得。
3. **最终链上候选**：合约部署与 Sourcify exact-match 对应 `a512e6996735ab83d088a80723d30e4f7bb897a9`，source-tree SHA-256 为 `854775537f58aa1d4312f19c09daa99b3c39b74b652d5e97a76e4cc0b494062b`。

固定研究 seed：`0x494c414c2d494e535449545554494f4e414c2d53545544592d5631`。  
记录工具链：Node `v24.13.0`、Foundry `1.5.1-stable`；研究 JSON 的独立 `solc` 探测结果为 `unavailable`，合约配置的 compiler target 为 Solidity `0.8.26`。

## 3. 当前验证总表

| 测试面 | 通过 | 失败 | 跳过 | 说明 |
|---|---:|---:|---:|---|
| Foundry | 282 | 0 | 0 | 单元、集成、fork、capacity、gas、fuzz、invariant、TCO |
| CLI | 56 | 0 | 0 | signer、keystore、issuer、policy、session、preflight、execute、revert decoding |
| SDK | 18 | 0 | 0 | v1/v2 typed data、session、hookData |
| Circuit oracle | 8 | 0 | 0 | schema、domain separation、duplicate、expiry、address validation |
| Circuit v1 | 4 outcomes | 0 | 0 | 1 valid accepted；3 adversarial rejected |
| Circuit v2 | 5 outcomes | 0 | 0 | 1 valid accepted；4 adversarial rejected |
| Secret scan | PASS | — | — | 当前树、Git history、官网、release metadata、npm tarball |
| Package dry run | PASS | — | — | `@ilalv3/cli@0.4.0-v2-poc.7` |
| SBOM | PASS | — | — | CLI、SDK、circuits CycloneDX |

### 3.1 Foundry 16 个 suite

| Suite | Tests |
|---|---:|
| `CNFIssuer.t.sol` | 62 |
| `InstitutionalNetting.t.sol` | 45 |
| `ILALRouter.t.sol` | 33 |
| `ComplianceHook.t.sol` | 30 |
| `PolicyRegistry.t.sol` | 24 |
| `ComplianceHookV2.t.sol` | 21 |
| `InstitutionalCapacityStudy.t.sol` | 16 |
| `PolicyGrantManagerV2.t.sol` | 15 |
| `ChainlinkStablecoinOracleGuard.t.sol` | 12 |
| `Fuzz.t.sol` | 9 |
| `InstitutionalNettingInvariant.t.sol` | 6 |
| `Groth16VerifierAdapterV2.t.sol` | 4 |
| `InstitutionalNettingFork.t.sol` | 2 |
| `ChainlinkStablecoinOracleGuardFork.t.sol` | 1 |
| `InstitutionalTcoStudy.t.sol` | 1 |
| `MockEASDeployment.t.sol` | 1 |
| **合计** | **282** |

## 4. 安全、原子性与对抗测试

### 4.1 Stateful invariant

配置：6,250 runs × depth 16 = **100,000 handler calls**。

| Property | 结果 |
|---|---|
| batch context 永远关闭 | PASS |
| gross = matched + residual | PASS |
| Hook 与 Router 零库存 | PASS |
| 最新 nonce 不可重放 | PASS |
| residual 最多出现在一侧 | PASS |
| token conservation | PASS |

六项 invariant 均为 100,000 calls、0 revert、0 discard。

### 4.2 Fuzz 与边界

- `previewAccounting`：10,001 次固定 seed 运行，PASS。
- 普通 CI fuzz baseline：每项至少 256 runs。
- adversarial regression：8/8 PASS。
- 覆盖 allowance/balance race、nonce cancellation/replay、policy rotation、expired order、invalid signature、invalid/wrong credential、malicious executor、tick `±99/±100/±101`。
- Chainlink 覆盖 exact boundary、超限 1 bps、零/负 answer、未初始化 round、stale/future timestamp、feed revert、不同 decimals、sequencer down 与 grace period。
- oracle 拒绝发生在 nonce 消耗与资产移动之前；失败后余额、nonce 与 batch context 回滚。

### 4.3 Findings ledger

| ID | Severity | Status | 处理 |
|---|---|---|---|
| `P2-FEE-SURFACE` | P2 | documented | candidate 只支持 5 bps；其他 fee tier 作为 unsupported rows，不外推 |
| `P2-RWA-QUADRATIC-IMPORT` | P2 | fixed | 100k import 从重复线性查找改为批次索引 |
| `P2-DUPLICATE-WALLET` | P2 | fixed | duplicate wallet 从覆盖改为明确拒绝 |
| `P3-CAPACITY-RUNNER-GAS` | P3 | fixed | 135-row frontier 拆为 15 个确定性 group |
| `P3-REPRO-RUNTIME-FIELDS` | P3 | fixed | normalized hash 排除运行时间/RSS，保留语义结果 |
| `P3-SEPOLIA-EXTENDED-BATCH` | P3 | fixed | 新 candidate 完成 2/4/16-order 与 exact-match |

没有开放的 P0/P1。

## 5. 两订单 impact benchmark

假设：6 decimals、raw-unit 1:1、5 bps pool、tick 0、liquidity `1e12`、range `[-1000,1000]`。Vanilla 两种执行顺序均运行；output 取更优 vanilla，gas 取更低 vanilla，因此不依赖有利排序。

| token0 / token1 | Gross | Matched gross | Residual | AMM exposure reduction | Output advantage | Advantage | ILAL / vanilla execution gas |
|---|---:|---:|---:|---:|---:|---:|---:|
| 100 / 25 | 125 | 50 | 75 | 40.00% | 0.025001 | 2.0012 bps | 698,849 / 195,556 |
| 100 / 50 | 150 | 100 | 50 | 66.67% | 0.050000 | 3.3351 bps | 698,850 / 195,557 |
| 100 / 70 | 170 | 140 | 30 | **82.35%** | **0.070000** | **4.1197 bps** | 698,353 / 195,556 |
| 100 / 90 | 190 | 180 | 10 | 94.74% | 0.090001 | 4.7393 bps | 698,849 / 195,556 |
| 100 / 100 | 200 | 200 | 0 | 100.00% | 0.100001 | 5.0026 bps | 657,422 / 195,567 |

Canonical `100/70` 的最终 pool state 与从相同状态执行一笔 vanilla 30-token0 residual swap 相同。用户 output 改善伴随 LP fee volume 减少与更高 execution gas；不能把它表述为对所有参与者无条件更优。

原始数据：[benchmark-results.json](../hookathon/benchmark-results.json)；方法：[BENCHMARK.md](../hookathon/BENCHMARK.md)。

## 6. Gas break-even

模型固定 `N / 0.7N`、gross `1.7N`，保守 total-gas premium 为 **485,401 gas**；收益约为 anchor notional 的 **6.99995 bps**。下表为参数敏感性，不是实时 ETH/Base 价格。

| ETH/USD | L2 gas | Break-even anchor | Break-even gross |
|---:|---:|---:|---:|
| $2,000 | 0.01 gwei | $13.87 | $23.58 |
| $2,000 | 0.1 gwei | $138.69 | $235.77 |
| $2,000 | 1 gwei | $1,386.87 | $2,357.68 |
| $3,000 | 0.01 gwei | $20.80 | $35.37 |
| $3,000 | 0.1 gwei | $208.03 | $353.65 |
| $3,000 | 1 gwei | $2,080.31 | $3,536.52 |
| $4,000 | 0.01 gwei | $27.74 | $47.15 |
| $4,000 | 0.1 gwei | $277.37 | $471.54 |
| $4,000 | 1 gwei | $2,773.74 | $4,715.36 |

在 ETH `$3,000`：anchor `$100` 只在 `0.01 gwei` 为正；`$1k` 在 `0.01/0.1 gwei` 为正；`$10k` 与 `$100k` 在三档 gas 输入下均为正。该旧 break-even sweep 不含 L1 data fee；严格 Base fork gate 在第 9 节单独计入。

原始数据：[break-even-results.json](../hookathon/break-even-results.json)；方法：[BREAK_EVEN.md](../hookathon/BREAK_EVEN.md)。

## 7. 160-row 经济矩阵

矩阵维度：

- Anchor notional：`$100 / $1k / $10k / $100k`
- Matching ratio：`25 / 50 / 70 / 90 / 100%`
- Pool fee：`1 / 5 / 30 / 100 bps`
- Liquidity：candidate-fixed / scaled

| 分类 | Rows |
|---|---:|
| 总行数 | 160 |
| 5 bps 实测 | 40 |
| Full fill | 35 |
| Capacity-limited | 5 |
| Unsupported fee configuration | 120 |

只有 5 bps 是当前 candidate 支持面。1/30/100 bps 没有被伪装成推算结果。

### `$10k / 70% / 5bps / scaled` local anchor

| 指标 | ILAL | Direct v4 independent | Direct v4 bundled local envelope |
|---|---:|---:|---:|
| Output raw | 16,998,410,092 | 16,991,410,146 | 16,991,410,146 |
| Total gas | 719,571 | 242,880 | 221,880 |
| LP fee raw | 1,500,000 | 8,500,000 | 8,500,000 |
| Full fill | yes | yes | yes |

Output advantage `$6.999946`；local gas premium 476,691；1 gwei / ETH `$3k` 的 L2 premium `$1.430073`；solver reserve `$0.85`；未计 L1 时净收益 `$4.719873`。正式经济判定由 Base fork 覆盖。

原始矩阵：[local-economic-matrix.csv](results/local-economic-matrix.csv) / [local-study.json](results/local-study.json)。

## 8. Capacity frontier

完整矩阵：5 liquidity multipliers × 3 ranges × 3 initial ticks × 3 PoolManager balance multipliers = **135 rows**。每行使用二分搜索记录最大安全 notional、首个失败 notional、selector、limiting factor 与 preflight verdict。

| Liquidity multiplier | Rows | 跨 range/tick/balance 的最低安全 notional | 最高安全 notional |
|---:|---:|---:|---:|
| 0.25× | 27 | $137 | $544,580 |
| 0.5× | 27 | $137 | $1,000,000 |
| 1× | 27 | $137 | $1,000,000 |
| 2× | 27 | $2,987 | $1,000,000 |
| 10× | 27 | $2,987 | $1,000,000 |

全矩阵安全上限范围为 `$137–$1,000,000`。低值场景通常由物理 manager balance、初始 tick 或窄 range 限制；`$1,000,000` 是本次搜索 ceiling，不等于无穷容量。固定 candidate depth 的 `$100k/70k` 回归继续被识别为 capacity-limited，并原子回滚。

原始数据：[capacity-frontier.csv](results/capacity-frontier.csv)。

## 9. Base production-fee benchmark

Pinned Base mainnet fork：block `50,421,294`，hash `0xbc939734549534974f0f8390687d5d38f564fde27d6ad448f3a47014aafbe145`。

真实 bytecode surface：Base USDC、Base USDT、官方 PoolManager、Universal Router、Permit2、GasPriceOracle 均存在且记录 SHA-256。

| Baseline | Output raw | Execution gas | Total gas | Full fill |
|---|---:|---:|---:|---|
| Universal Router independent | 16,991,410,060 | 188,849 | 243,957 | yes |
| Universal Router bundled | 16,991,410,146 | 184,218 | 217,410 | yes |

### 严格 go/no-go gate

| 项目 | 数值 |
|---|---:|
| Baseline | bundled Universal Router + Permit2 |
| Output advantage | `$6.999946` |
| Gas premium | 502,161 |
| L2 premium（1 gwei、ETH $3k） | `$1.506483` |
| Candidate L1 security fee | `$0.00001321` |
| Solver reserve（0.5 bps gross） | `$0.85` |
| **Net benefit** | **`$4.643450`** |
| Gate | **PASS** |

模型保守地收取 candidate 全部 L1 fee，同时不给 vanilla 计 L1 fee，因此不会高估 ILAL 优势。

原始数据：[fork-study.json](results/fork-study.json)。

## 10. 多订单可扩展性

固定 `$10k / 70% / 5bps / scaled liquidity`；三种 distribution 的 matched raw 均为 14,000,000,000，rounding dust 均为 0，permutation commitment 均稳定。

| Orders | Distribution | Total gas | Gas/order | Gas/matched raw token |
|---:|---|---:|---:|---:|
| 2 | uniform | 705,715 | 352,857.50 | 50.4082 |
| 4 | uniform | 851,854 | 212,963.50 | 60.8467 |
| 8 | uniform | 1,162,960 | 145,370.00 | 83.0686 |
| 16 | uniform | 1,825,968 | 114,123.00 | 130.4263 |
| 2 | one-large-many-small | 705,909 | 352,954.50 | 50.4221 |
| 4 | one-large-many-small | 850,144 | 212,536.00 | 60.7246 |
| 8 | one-large-many-small | 1,168,364 | 146,045.50 | 83.4546 |
| 16 | one-large-many-small | 1,836,087 | 114,755.44 | 131.1491 |
| 2 | long-tail | 706,648 | 353,324.00 | 50.4749 |
| 4 | long-tail | 855,407 | 213,851.75 | 61.1005 |
| 8 | long-tail | 1,177,043 | 147,130.38 | 84.0745 |
| 16 | long-tail | 1,815,753 | 113,484.56 | 129.6966 |

Gas/order 随 batching 下降，但总 gas 与 gas/matched token 随 order count 上升。16-order live Base Sepolia 交易使用 1,896,404 gas，与本地量级一致。

## 11. RWA issuer 数据与 proof

数据集仅包含 wallet、KYC tier、country、expiry、status 与 hashed source reference，不包含姓名、证件号等 PII。

### 11.1 Base journey

| Wallets | Init | Import + root | Root | Witness | Total | Peak RSS |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 0.225s | 0.218s | 0.430s | 0.433s | 1.306s | 132.6 MiB |
| 1,000 | 0.201s | 0.241s | 2.110s | 2.129s | 4.681s | 135.5 MiB |
| 10,000 | 0.211s | 1.060s | 19.735s | 19.544s | 40.551s | 217.0 MiB |
| 100,000 | 0.214s | 69.381s | 219.014s | 252.718s | **541.328s** | 665.1 MiB |

100k artifacts：CSV 8,488,950 bytes；encrypted store 38,534,128 bytes；policy 654 bytes；witness 4,872 bytes。

### 11.2 Churn

| Wallets | Churn | Import | Root | Peak RSS |
|---:|---:|---:|---:|---:|
| 100 | 1% | 0.215s | 0.399s | 132.3 MiB |
| 100 | 5% | 0.215s | 0.389s | 131.8 MiB |
| 100 | 10% | 0.222s | 0.388s | 132.2 MiB |
| 1,000 | 1% | 0.220s | 2.155s | 134.8 MiB |
| 1,000 | 5% | 0.224s | 2.019s | 134.7 MiB |
| 1,000 | 10% | 0.221s | 1.929s | 135.2 MiB |
| 10,000 | 1% | 0.247s | 19.622s | 173.7 MiB |
| 10,000 | 5% | 0.256s | 18.893s | 174.7 MiB |
| 10,000 | 10% | 0.251s | 17.961s | 175.3 MiB |
| 100,000 | 1% | 0.539s | 194.407s | 582.0 MiB |
| 100,000 | 5% | 0.624s | 188.293s | 608.1 MiB |
| 100,000 | 10% | 0.709s | 180.788s | 661.2 MiB |

### 11.3 Proof generation

- Runs：20
- Min：3.013s
- p50：3.221s
- p95：**3.612s**
- Max：3.634s
- Peak RSS：**3,832,889,344 bytes = 3.57 GiB**
- Gate：p95 ≤ 30s，PASS；peak RSS ≤ 4 GiB，PASS，但 pilot host 必须保留额外系统内存余量。

### 11.4 Negative coverage

`wrong-password`、`corrupt-store`、`broad-permissions`、`duplicate-wallet`、`illegal-fields`、`expired-record`、`revoked-record` 全部覆盖。

原始数据：[rwa-study.json](results/rwa-study.json) / [rwa-operational-metrics.csv](results/rwa-operational-metrics.csv)。

## 12. 参数化 TCO

共 243 rows：3 execution paths × 3 churn × 3 staff rate × 3 ETH price × 3 L2 gas price。

Measured gas primitives：

| Primitive | Gas |
|---|---:|
| v1 attestation | 118,123 |
| v1 mint | 242,101 |
| v2 policy | 138,493 |
| v2 grant | 61,520 |
| benchmark allowlist write | 23,054 |

示例：100k wallets、10% churn、staff `$100/h`、ETH `$3k`、L2 gas `1 gwei`：

| Path | Issuer-paid | User-paid | Total system | Transactions |
|---|---:|---:|---:|---:|
| ILAL v1 CNF/EAS | $3,568.69 | $7,263.03 | $10,831.72 | 20,000 |
| ILAL v2 ZK policy grant | $25.42 | $1,845.60 | $1,871.02 | 10,001 |
| Benchmark-only onchain allowlist | $716.62 | $0 | $716.62 | 10,000 |

这只是参数模型，不是客户 ROI。Allowlist baseline 不包含供应商、法律、数据库和集成成本；自动化 wall time 只是 operator-time proxy；TCO 文件的 L1 proxy 为 0，因此不得用它替代第 9 节的严格 Base fee gate。

原始数据：[tco-study.json](results/tco-study.json) / [tco-sensitivity.csv](results/tco-sensitivity.csv)。

## 13. Chainlink oracle guard

| 项目 | 数据 |
|---|---|
| Enforcement | `openBatch` fail-closed hard gate |
| USDC/USD | `0xd30e…5165`，8 decimals，snapshot 1.00000000 |
| USDT/USD | `0x3ec8…934f`，8 decimals，snapshot 0.99994000 |
| Max age | 90,000 seconds |
| Individual deviation | 100 bps |
| Pair deviation | 100 bps |
| Local warm call | 37,541 gas |
| Constant-snapshot baseline | 1,181 gas |
| Incremental | 36,360 gas |
| Unit tests | 12/12 PASS |
| Real-feed fork | 1/1 PASS |

Base Sepolia 未列出官方 uptime proxy，因此 candidate 关闭 sequencer check。Base mainnet 必须配置官方 feed 与 3,600 秒 recovery grace，否则仍是 production blocker。

## 14. Base Sepolia 最终候选

| Contract | Address | Verification |
|---|---|---|
| InstitutionalNettingHook | [`0x8d1f…0088`](https://sourcify.dev/server/v2/contract/84532/0x8d1fA43F848701b2adB105D5c925A9247E600088) | exact match |
| InstitutionalBatchRouter | [`0x9645…2506`](https://sourcify.dev/server/v2/contract/84532/0x96456C68f25A1Fa6C2F2751183401ac26A732506) | exact match |
| ChainlinkStablecoinOracleGuard | [`0x1dEc…99D3`](https://sourcify.dev/server/v2/contract/84532/0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3) | exact match |
| hUSDT | `0xC494…c72C` | exact match；ILAL test representation |
| MockEAS | `0xDF98…Eecd` | exact match |
| CNFIssuer | `0x4B3f…2386` | exact match |
| PolicyRegistry | `0x12C7…5a61` | exact match |

USDC 使用 Circle 官方 Base Sepolia test asset `0x036CbD53842c5426634e7929541eC2318f3dCF7e`；hUSDT 不是官方 USDT。

### 14.1 成功 batch

| 场景 | Tx | Block | Gas used | Preflight gas | 结果 |
|---|---|---:|---:|---:|---|
| Forward `0.10 / 0.07` | [`0x9177…0998`](https://sepolia.basescan.org/tx/0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998) | 45,934,588 | 640,837 | 828,310 | 0.14 matched；0.03 USDC residual |
| Reverse `0.06 / 0.09` | [`0x588a…5172`](https://sepolia.basescan.org/tx/0x588ac879d9287435e04af158acf4b491f77baa2cdfe6e6729eab16ecf46f5172) | 45,934,631 | 640,650 | 828,068 | 0.12 matched；0.03 hUSDT residual |
| 4-order | [`0xf6d7…5954`](https://sepolia.basescan.org/tx/0xf6d74bd973b6c26c63ec7317dff87ba8055d8946eb2b637791b5376e1d335954) | 45,934,699 | 801,183 | 1,034,970 | success |
| 16-order | [`0x8835…0b7`](https://sepolia.basescan.org/tx/0x883560276318337104db9020513ec685bb8ae672a3678f77d682f885093f40b7) | 45,934,788 | 1,896,404 | 2,270,429 | success |

Postconditions：Hook token0/token1 = 0；Router token0/token1 = 0；`batchActive=false`；成功交易 4/4；广播 reverted tx = 0。

### 14.2 已知失败候选

早期单一 wide position candidate 在首笔 0.03 residual 后从 tick 0 移动到 -591，超出 `±100` operating envelope，因此标记为 `aborted`。后续 reverse batch 在 preflight 被拒绝，没有广播、没有 nonce/资产变化。最终 candidate 使用 wide `[-10000,10000]` + stabilizer `[-100,100]` 并完成顺序回归。

证据：[最终 manifest](../hookathon/chainlink-candidate-manifest.json) / [aborted manifest](../hookathon/aborted-chainlink-candidate-2026-08-25.json)。

## 15. 可重复性

`reproducibility.json` 状态为 PASS，并保存规范化 JSON 与确定性 CSV 的 SHA-256：

| Artifact | SHA-256 |
|---|---|
| `local-study.json` | `5054b32b4d3f6e16ffc40d11c0f0d0cf02ecc18174713c1a90a57a8a9be5cd83` |
| `fork-study.json` | `299a04f55a3f0338b104fdd9f5ffae2c1e68aab294d48a3b6d1c15f8e147817a` |
| `rwa-study.json` | `84db60537176fa1731503f2353d68e563f87364ad7d955fb0f5709b897d43a8c` |
| `stress-study.json` | `40d0b196e9c0f8d2af02d6f19e9dc7e3b45da5ab6fc7c63e554603824cd9bd6d` |
| `local-economic-matrix.csv` | `f06592cf08f2decac61f4c59e9cee849a15e6a3d1ef6added20d54a0222ca234` |
| `capacity-frontier.csv` | `fac07577b2640812528107ccd9a9879b72d9089e604b0ce2e3bf6f216c72fa59` |
| `tco-sensitivity.csv` | `6a61c4b51ed19f212fdc66eb9b431354fb9ac357ae01a4e6bdf0ffeea9f1e217` |

注意：reproducibility 文件记录的 fork block 与当前保留的 `fork-study.json` block 不相同，因为 finalized fork 在不同运行间推进；规范化 hash 排除了这些运行时字段。要获得严格的同块重跑，应显式传入并冻结 fork block。

## 16. 支持域与限制

### 当前支持

- 2–16 orders
- standard equal-decimal ERC-20 stablecoins
- raw-unit 1:1 internal match
- 5 bps pool、tick spacing 10
- Chainlink 100 bps / 90,000 秒 gate
- batch-start pool tick `±100`
- exact-input、signed `minAmountOut` 与 `maxAmmInput`

### 当前不支持或不能宣称

- fee-on-transfer、rebasing、callback/nonstandard tokens
- 1/30/100 bps fee tier
- 超过池深度或 PoolManager 物理余额的 batch
- 不宣称消除全部 mempool MEV
- 不宣称所有 notional/gas 情景均经济为正
- 不宣称真实客户 ROI
- 不宣称已审计或 production-ready

## 17. 原始数据索引

- [study-summary.json](results/study-summary.json)
- [local-study.json](results/local-study.json)
- [local-economic-matrix.csv](results/local-economic-matrix.csv)
- [capacity-frontier.csv](results/capacity-frontier.csv)
- [fork-study.json](results/fork-study.json)
- [stress-study.json](results/stress-study.json)
- [rwa-study.json](results/rwa-study.json)
- [rwa-operational-metrics.csv](results/rwa-operational-metrics.csv)
- [tco-study.json](results/tco-study.json)
- [tco-sensitivity.csv](results/tco-sensitivity.csv)
- [findings-ledger.json](results/findings-ledger.json)
- [findings-ledger.csv](results/findings-ledger.csv)
- [reproducibility.json](results/reproducibility.json)
- [sepolia-evidence.json](results/sepolia-evidence.json)
- [benchmark-results.json](../hookathon/benchmark-results.json)
- [break-even-results.json](../hookathon/break-even-results.json)
- [chainlink-candidate-manifest.json](../hookathon/chainlink-candidate-manifest.json)

## 18. 最终判断

ILAL 已证明：

1. 支持域内的 verified opposing flow 可以原子 netting，只有 residual 进入 Uniswap v4。
2. 守恒、原子性、nonce 单次使用、canonical allocation 与零库存可以在 100k stateful calls 下保持。
3. `100/70` 中 AMM exposure 减少 82.35%，aggregate output 提升 4.1197 bps，但支付约 3.57× 的本地 execution-gas cost。
4. 在严格 `$10k / 70% / 5bps` Base fee 模型下，扣除 L2 premium、candidate L1 fee 与 solver reserve 后净收益仍为 `$4.64345`。
5. 100k PII-free issuer journey 与 proof latency 达到设定门槛，但 proof memory 对 pilot host 有明确要求。
6. 当前候选适合机构试点，不适合生产资金；下一步优先级是独立审计、mainnet sequencer guard、真实 issuer/desk pilot 与正式资产流量。
