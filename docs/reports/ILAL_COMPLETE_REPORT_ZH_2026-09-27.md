# ILAL 项目完整报告

日期：2026-09-27
代码基线：`58e8a5da38ef8f052d636ef8cbd06941d4b0037a`
分析范围：当前统一协议、发行方试点、本地验证与 Base Sepolia 公开演练。
状态：**unaudited · testnet sandbox · not production-ready**。

## 1. 项目结论

ILAL 已完成从协议组件到可运行发行方试点的收敛。当前有一套维护中的协议、一套 CLI/SDK、一套发行方演练流程，以及一次七地址分工的 Base Sepolia 实际部署与演练。它已经可以用代码、交易和事件说明产品机制，仍未跨过生产审计、真实身份服务、资产接入与权限治理的门槛。

统一定位为：

> **Policy-controlled atomic execution and settlement infrastructure for permissioned digital asset liquidity.**

中文含义是：面向许可型数字资产流动性的、由策略控制的原子执行与结算基础设施。

当前最强的证据是三件事：相反订单先内部匹配，只有未匹配部分进入 AMM；执行时重新验证资格与策略；LP 资格或策略失效后仍可退出。在一个 100/70 的平价测试中，170 单位双边输入中有 140 单位内部匹配，30 单位进入 AMM。这个结果是特定场景的输入压缩证明，不能外推为普遍的收益率或成本节省率。

当前建议是围绕发行方试点继续补足证据与接入能力，而非扩大产品线。

## 2. 用户、问题与产品边界

### 2.1 首个用户

首批目标用户是需要受控二级流动性的稳定币发行方。发行方希望把准入规则落实到交易执行中，并在撤销、策略更新或系统异常时保持资产所有者的退出能力。

第一场景包括两种职责明确的资产：

| 资产 | 定义 | 控制者 | 本次部署 |
| --- | --- | --- | --- |
| Asset A | Issuer Stablecoin | 发行方 | ipUSD，六位小数测试 ERC-20 |
| Asset B | USDC-like Settlement Asset | 独立结算资产运营角色 | sUSD，六位小数测试 ERC-20 |

sUSD 不是实际 USDC；ipUSD 和 sUSD 均不代表储备、赎回承诺或真实美元价值。两个资产采用公开参考价格，不会因此获得信用或兑付保障。

### 2.2 ILAL 提供什么

- 池级准入策略与可撤销资格。
- 可复用的短期资格 grant。
- 带金额、价格、期限、AMM 暴露上限及 nonce 的签名授权。
- 同批次相反订单的内部匹配与 residual AMM 执行。
- 一笔交易内完成执行、结算及失败回滚。
- 所有者隔离的 LP 仓位、退出与费用领取。
- 用于集成、操作、复现及核查的 SDK、CLI、配置和证据文件。

### 2.3 ILAL 不提供什么

ILAL 不承担 KYC/KYB 判断、监管合规认证、法币发行与赎回、托管、交易后撤销或生产 SLA。发行方控制的是对应 ILAL 池的参与资格，不能据此声称控制代币在协议外的转账或持有。

真实身份检查、资产法律安排、储备管理及制裁筛查仍由发行方及其服务商负责。

## 3. 产品结构与执行机制

### 3.1 一套协议

当前维护实现统一为 ILAL v1。Session、SOEE 和旧版本材料属于历史设计；它们不再构成并列的当前产品。内部 `Mixed*` 合约、JSON 和签名域名称保留，是为了维持已有接口和部署格式。

当前软件版本为 `1.0.0-dev.0`，CLI/SDK 尚未公开发布。候选部署版本号不意味着软件已经正式发布。

### 3.2 核心组件

| 组件 | 责任 |
| --- | --- |
| Policy Registry | 池策略、revision、用户 ban、资格来源配置及治理延迟 |
| Grant Manager | 验证资格并维护池级 grant 的有效性 |
| Hook | 在 Uniswap v4 交互中实施执行上下文和授权约束 |
| Execution Router | 接收签名订单、内部匹配、执行剩余量与结算 |
| Liquidity Router | 管理用户隔离的 LP 仓位与退出/领取授权 |
| Oracle Guard | 检查参考价格及相关价格边界 |
| Uniswap v4 PoolManager | 提供原子账户结算与 residual 流动性执行 |
| SDK / CLI / Console | 编码、查询、签名、报价、操作与集成 |

执行路径为：

```text
发行方资格源 → 池级 grant → 独立 ERC-20 allowance + 订单签名
                                      ↓
                            quote 强制回滚模拟
                                      ↓
                           执行时重新检查当前状态
                                      ↓
                         内部匹配 → residual AMM
                                      ↓
                           原子结算或整批回滚
```

### 3.3 三种授权不能混淆

资格回答“谁可以参与”；订单签名回答“允许执行哪一笔交易”；ERC-20 allowance 回答“允许哪个合约转移哪些代币”。Grant 复用资格，不替代订单签名，也不授予代币花费权。

CNF 资格会在使用时重新读取。ZK grant 绑定 root 与 epoch，根变化会影响已有 grant；本次公开试点只使用 CNF。ZK 作为协议能力保留，其生产证明参数与 ceremony 仍需独立审查。

协议使用 EIP-712 域和六个独立 nonce 命名空间，区分 batch、direct、grant、LP add、exit 与 collect。签名、nonce 与仓位隔离共同限制授权复用。

### 3.4 Quote 与 execution

Quote 通过完整计算后强制 revert 返回结果，模拟中的余额、nonce 和上下文更改全部撤销。因此 quote 不是可持久化的交易许可。

实际执行重新检查策略、资格、期限、签名、交易限制、余额与 allowance。报价成立之后，资格仍可能撤销、策略可能失效、市场状态可能改变。

执行在一笔交易、一次 PoolManager unlock 内完成，不依赖跨交易暂存订单资产或保存执行上下文。

## 4. 两项核心 invariant

### 4.1 只有未匹配部分进入 AMM

> Only the unmatched residual may reach public AMM liquidity. Internally matched flow must never be exposed to the AMM.

平价下，两笔输入分别为 100 和 70，双边各匹配 70。因此 gross 是 170，matched input 合计为 140，residual 为 30。

这里的 140 是双边已匹配输入总和，对应一笔 70 对 70 的交换，不是单边 140 的成交。非平价或不同单位场景必须先统一估值，不能机械相加代币数量。

PoolManager 同时承担结算功能：它接收的 ERC-20 Transfer 总额可能包含内部匹配资金。**进入 PoolManager 的转账不等于进入 AMM 曲线的输入。** 完整核查应结合 Router 分配、PoolManager Swap 事件和代币收支，而不能仅看 Transfer。

### 4.2 策略不得锁住 LP 本金

> Policy enforcement must never trap LP principal. Eligibility controls new risk-taking actions, not withdrawal of existing assets.

新增流动性需要当前有效资格。退出与费用领取仍要求所有者授权，但不依赖资格继续有效或 oracle 正常工作。

用户仓位通过用户地址和 salt 隔离。该 invariant 保护的是提款权限，不保证本金的市场价值，也不消除做市价格风险、代币自身限制或底层合约故障。

## 5. Base Sepolia 实测

### 5.1 范围与角色

公开候选：`v1.0.0-issuer-pilot-testnet.1`，chain ID `84532`。记录快照为区块 `47334178`，时间为 2026-09-26 15:30:44 UTC（北京时间 23:30:44）。

七个不同地址分别承担 deployer、issuer、settlement asset operator、LP、institution A、institution B 和 executor。它们证明了地址及权限分离，但本次由同一演练操作方组织，不能称为七个独立机构参与。

16 笔部署交易完成合约、路由绑定、策略配置与池初始化。演练包括 32 笔成功交易和 1 笔预期回滚交易。

### 5.2 实际成交

| 项目 | Institution A | Institution B |
| --- | ---: | ---: |
| 输入 | 100 ipUSD | 70 sUSD |
| 内部匹配输入 | 70 ipUSD | 70 sUSD |
| AMM 输入 | 30 ipUSD | 0 |
| 最终输出 | 99.984991 sUSD | 70 ipUSD |

合计 170 gross、140 matched、30 residual，内部匹配比例 **82.3529%**，AMM 输入比例 **17.6471%**。

成功交易：[0x409a…711ff](https://sepolia.basescan.org/tx/0x409a4d9f097c96c8096b51d00429857b6f6b000207e454115a0bbd6c73d711ff)。本轮分析已读取 receipt、OrderSettled 与 Transfer；输出与记录的 quote 一致。SDK 对订单按规范排序，事件 index 不能直接当作原始 A/B 提交顺序，应按 user 映射。

### 5.3 输出差额与经济含义

30 ipUSD 的 residual 输出 29.984991 sUSD。按 1:1 基准，输出差额为 0.015009，相当于 residual 的 **5.003 bps**，其中约 5 bps 对应池费率，剩余为曲线价格影响及舍入。

按 Institution A 的 100 单位完整输入计算，差额为 **1.5009 bps**。这些数值均未纳入 Gas、运营成本、信用风险或真实资产价格偏离。

本次 LP 注入约 487.68 万单位的每种资产，交易却只有 100/70，因此这是非常深的合成流动性场景。价格影响很小符合该配置，不能用它预测低流动性市场的表现。

**82.35% 是本例的 AMM 输入压缩率，不是净收益率，也不是已经证明的总成本节省率。**

### 5.4 执行时政策检查

公开 TOCTOU 路径为：有效 quote → issuer ban → 同一组原签名订单执行 → 链上回滚。

| 时间（UTC） | 事件 |
| --- | --- |
| 15:29:32 | Issuer ban Institution A |
| 15:29:36 | 原签名订单执行回滚 |
| 15:29:42 | Institution A 的 CNF 被撤销 |
| 15:29:54 | LP 的 CNF 被撤销 |
| 15:30:00 | 池策略关闭 |
| 15:30:12 | LP 第一次退出 |
| 15:30:24 | 独立 collect 调用 |
| 15:30:42 | LP 剩余流动性退出 |

回滚交易：[0x6e14…c455](https://sepolia.basescan.org/tx/0x6e146a19bffa83236ddf4d936ca988e150e429d7d51d8ccc493a94add4b1c455)。Receipt 为 reverted，日志数为零；演练脚本在前后断言了机构余额与订单 nonce 不变。

这次公开测试采用的是即时 ban / user epoch 失效；本地测试覆盖的是 policy revision 生效后的失败路径。两者不应混为同一个公开测试。

CNF 撤销发生在 ban 之后，所以后续 quote 拒绝存在已有 ban 的干扰。它证明组合状态拒绝执行，不能单独归因于 CNF 撤销。独立 CNF 撤销因果测试是下一轮应补的项目。

### 5.5 LP 本金与费用

| 资产 | 初始投入 | 两次退出合计 |
| --- | ---: | ---: |
| sUSD | 4,876,819.758128 | 4,876,789.773136 |
| ipUSD | 4,876,819.758128 | 4,876,849.758125 |

两次退出各移除 `50,000,000,000,000` 流动性单位，合计等于初始新增量。流动性单位不是代币余额，不能按六位小数直接解释为美元。

第一次退出的 LiquiditySettled 事件记录 `fees1 = 14999`，即 **0.014999 ipUSD**。之后的独立 collect 成功，但费用为零，因为既有费用已随第一次减仓结算。

因此已证实的是：失效状态下可退出本金、减仓中可结算非零费用、独立 collect 路径可执行。尚未单独演示“失效状态下直接 collect 非零费用且不减仓”。

按两种资产均为 1 的假设，退出合计比投入增加 0.015005；这是一次交易与舍入后的账面变化，不构成 LP 收益预测。

Hook、Execution Router 和 Liquidity Router 两种资产余额均为零。此前最新读数中，PoolManager 保留 1 raw unit sUSD 和 3 raw units ipUSD，即 0.000001 / 0.000003 的舍入尘埃；不能把“ILAL 路由零库存”扩写成所有合约绝对无余额。

### 5.6 Oracle 证据边界

公开部署使用 live Chainlink reference feeds，演练未改变这些 feed 的真实状态。脚本向 guard 传入无效价格进行只读失败探测，再验证失效资格和关闭策略下的退出。

这不是“真实 oracle 故障期间提款”的链上因果证明。完整可变 oracle 故障状态测试属于本地验证范围。公开 evidence 的 `oracleFailureInduced: true` 应结合其 method 字段理解，未来建议拆分为更准确的 probe / state-failure 字段。

### 5.7 Gas 与时间

| 阶段 | 交易数 | Gas used | Gas used × effectiveGasPrice（ETH） |
| --- | ---: | ---: | ---: |
| 部署 | 16 | 14,454,005 | 0.00008672464534495 |
| 演练，含预期回滚 | 33 | 3,806,025 | 0.00002283615 |
| 合计 | 49 | 18,260,030 | 0.00010956079534495 |

此费用列仅为 receipt 的 gasUsed 与 effectiveGasPrice 乘积；未另行核对 L1 data fee 或运营商附加费用，因此不标为完整钱包总扣费。测试网价格也不代表主网价格。

| 操作 | Gas used |
| --- | ---: |
| Add liquidity | 406,729 |
| 两订单 batch execution | 647,544 |
| Policy ban | 76,265 |
| 预期回滚 execution | 177,770 |
| 第一次退出 | 198,896 |
| Collect | 120,450 |
| 最终退出 | 144,421 |

演练包含 12 次 approve，共 557,568 gas。按本次实际角色需求，可收紧为 LP 对两资产的流动性授权、A 对 ipUSD 的执行授权、B 对 sUSD 的执行授权，共四次；这是操作流程优化，不是协议核心收益。

从演练首笔资金转入到最终退出约 5 分 20 秒。Ban 至失败交易上链相隔 4 秒，策略关闭至首次退出相隔 12 秒。这些是顺序脚本运行时间，不是吞吐、确认 SLA 或性能基准。

## 6. 本地验证与工程状态

此前完整 `make verify` 已通过，PR #21 与合并后 main CI 也已成功。合并后的运行：[GitHub Actions](https://github.com/rpnny/ILAL/actions/runs/36292208995)。

已记录的验证包括基础合约套件 128 passed / 2 skipped、单独开启的 Mixed 真实证明和差分套件 50 passed、2,500 轮与 100,000 次 handler 调用的 invariant 测试，以及 CLI、SDK、电路约束、打包、ABI 一致性、代码体积、secret scan、SBOM 与本地发行方流程。不同套件覆盖有重叠，不能将这些数字简单相加作为独立测试总数。

开发工具链包括 Node.js 24、Foundry v1.5.1、Circom 2.2.3。CI 已修正 circom 必须先于 circuits prepare 安装的 bootstrap 顺序。公开广播流程也加入对 Base 零 blockHash 预确认 receipt 的处理。

测试成功说明这些配置与输入下行为符合断言，不替代独立安全审计、形式化证明或生产运维验证。

## 7. 证据完整性审查

这是当前最需要优先加强的工程部分。

### 7.1 已经具备的能力

证据文件记录角色、资产职责、池标识、交易、输出、余额、nonce、流量和测试断言。静态验证器检查基本分解、输出一致性、角色地址不复用、若干负向断言及零库存字段；可选 RPC 验证会检查链 ID、成功交易 receipt、部署绑定、当前库存和成功订单 nonce。

Manifest 记录 evidence SHA-256，发布检查会检测内容与摘要不一致。

### 7.2 当前尚未做到的完整独立复核

直接审查 `verify-evidence.mjs` 与 `model.mjs` 后，可以确认：

1. RPC 查询没有统一指定 evidence snapshot 的 blockNumber，也没有验证该 snapshot 的 blockHash。记录快照不等于所有状态均在固定区块复核。
2. 流量主要通过 JSON 数值及演练脚本断言验证；独立验证器尚未从链上事件重算整个 170/140/30，也未交叉验证 PoolManager Swap。
3. 负向结果主要依赖 evidence 内的布尔断言。TOCTOU 回滚 hash 位于 negativeTests，不在成功 receipt 遍历列表中，独立验证器没有专门核查该失败 receipt。
4. 已记录成功订单 nonce，但公开文件未完整保存失败订单、其 nonce 及失败前后状态。因此第三方不能仅凭该文件重做全部 TOCTOU 断言。
5. JSON Schema 的独立检查与当前手写静态验证不是同一回事；后者对字段完备性和所有测试因果关联的约束仍有限。
6. SHA-256 证明文件与登记摘要一致，不能单独证明链上断言真实或充分。

因此应将当前状态表述为：**已完成公开演练，并有版本化证据、脚本断言及部分独立链上核查；完整固定区块独立重算仍待补齐。** 此表述替代此前过强的“固定区块完整复核”。

这一差距属于证据工具成熟度，不直接说明交易结果错误；本轮已读出的成功交易事件与余额流转支持 100/70 场景的结果。

## 8. 经济价值与商业可行性

ILAL 的潜在价值来自将发行方控制、内部匹配和公开 residual 执行放在同一结算流程中。相反流量足够集中时，可以减少进入 AMM 曲线的输入及相关费用；交易与授权状态同步则减少报价时合法、执行时失效的风险。

但系统需要有足够的相反订单在同一批次出现。低匹配率、小订单和额外执行 Gas 会改变经济结论。

当前本地经济矩阵包含 48 组同状态比较、16 个保留失败样本和 4 组拆单/nonce 研究。维护中的经济说明明确记录：测得的输出改善为正，但在假定 1 gwei 与 ETH 3,000 美元的成本情景下，所测小额订单的净改善全部为负。这些是假设性成本参数，不是实时价格。

因此商业验证应衡量：同一初始市场状态下的 all-AMM 基线、净输出、全部网络费用、报价失效成本、等待成本与运营成本。尚无证据支持直接宣称客户 ROI、收入规模或产品市场契合度。

协议当前不收取协议费。未来收入模式属于待验证商业假设，不应写成已有能力或既定客户安排。

## 9. 风险与生产阻断项

| 项目 | 当前状态 | 进入生产前需要完成 |
| --- | --- | --- |
| 独立审计 | 未审计 | 合约、SDK、签名/编码、部署及相关电路审计 |
| 身份服务 | 沙盒 CNF | 真实 KYC/KYB 生命周期与撤销语义验收 |
| 治理 | 测试 EOA 角色 | Safe、职责分离、应急机制与密钥管理 |
| 资产 | 合成测试币 | 真实资产行为、冻结/黑名单、精度与法律边界审查 |
| Oracle | 公开参考 feed | 喂价适用性、陈旧阈值、偏离及 sequencer 策略 |
| 证据 | 部分独立核查 | 固定区块、事件重算、负向测试因果链 |
| 性能 | 单批次公开演练 | 多批次、并发、长时间与异常压力测试 |
| 经济性 | 特定场景输入压缩 | 同状态净收益基线与真实业务订单分布 |
| ZK | 开发证明路径 | 若生产启用，完成 ceremony 与 verifier 配置审查 |
| 运营 | 无生产 SLA | 监控、响应、升级/迁移与退出演练 |

其他边界包括执行者对批次和时机的选择、ERC-1271 行为、重入面、授权取消与 nonce 隔离、舍入、多资产单位和受限制代币行为。固定集合的排列独立性不等于执行者无法通过选择集合或时间影响结果。

部分 runbook / CLI 示例仍指向旧 `mixed-testnet.1` 候选，当前候选应以 `protocol.json` 为准。这是文档一致性待办，应避免客户集成到错误候选。

当前试点最后状态为策略关闭、演示 LP 完整退出。它是完成的历史演练实例，不应被描述为仍持续提供报价与流动性的在线池。

## 10. 建议执行顺序

### 优先级一：补齐可独立复核的证据

- 所有读数固定区块并核对 block hash。
- 从指定合约事件重算分配，结合 Swap 与 Transfer 核对 AMM 输入、输出与守恒。
- 记录并验证完整 TOCTOU 输入、失败 nonce、失败 receipt 和前后状态。
- 分开测试 policy ban、CNF 撤销和 policy revision，避免因果混淆。
- 在失效状态下先独立 collect 非零费用，再退出。
- 将 oracle probe 与真实 oracle failure 分成不同字段和验收项。

验收标准：第三方仅凭版本化文件、公开 RPC 与只读工具，能够独立重建关键结论，而无需相信 `passed: true`。

### 优先级二：形成可重复的发行方演练

收紧 allowance、完善中断恢复、统一当前候选文档，增加不平衡订单、过期 grant、低流动性、边界金额及并发场景。将准备、运行、核验、清理阶段明确分开。

验收标准：新操作人员可按文档在新候选完成流程，并对每个负向案例给出单独证据。

### 优先级三：发行方业务验证

围绕资产限制、资格生命周期、撤销延迟、订单规模及对手流量分布确定真实 pilot 范围，并用同状态基线计算净效果。

验收标准：形成明确参与方、资产范围、成功指标与生产阻断项的试点约定。之后再按资产与治理要求推进审计和生产接入。

## 11. 部署与来源索引

| 合约/资产 | Base Sepolia 地址 |
| --- | --- |
| Asset A / ipUSD | `0xd25ce3D03444b915E0DCE5C63ACBC30F90aCe38D` |
| Asset B / sUSD | `0x88c55Be44d6A24958D52d3585a84F6ddb192CC45` |
| Pilot CNF | `0xa74c1bb908f711ddd90D53DDb9b81bf55bD1F85c` |
| Hook | `0x0dDf18c4d6A7eD4E978ad92975E2e3981FEF4Aa8` |
| Execution Router | `0x3cAF5f2A080516f470897dc4176d71bF7efD35e7` |
| Liquidity Router | `0xAe4F779b5FD84103B5090ae3661d25B81906bc90` |
| Policy Registry | `0x22010c62112D554f13f4D7f2522b85cEBA1c5C4A` |
| Grant Manager | `0x1F603D0ba7B11955e553628446D0dC5a8f5416E9` |
| Oracle Guard | `0x7f0cA96E2855337983Fba6CAa4709321Ad5F49eb` |
| PoolManager | `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408` |

主要资料：

- [当前协议状态](../../protocol.json)
- [项目说明](../../README.md)
- [发行方试点](../pilot/ISSUER_PILOT.md)
- [协议规范](../mixed/SPEC.md)
- [经济测试说明](../mixed/ECONOMICS.md)
- [审计范围](../mixed/AUDIT_SCOPE.md)
- [部署 manifest](../../deployments/base-sepolia/v1.0.0-issuer-pilot-testnet.1.json)
- [公开 evidence](../../deployments/base-sepolia/evidence/v1.0.0-issuer-pilot-testnet.1.json)
- [只读验证器](../../scripts/pilot/verify-evidence.mjs)
- [静态校验实现](../../scripts/pilot/model.mjs)
- [公开演练脚本](../../scripts/pilot/rehearse-base-sepolia.mjs)
- [合并 PR #21](https://github.com/rpnny/ILAL/pull/21)

本报告以仓库一手资料和本次会话内已读取的链上数据为依据。交易历史数据对应指定交易；“当前状态”读数对应此前查询的最新区块约 `47356792`，不代表报告打开时仍然相同。本报告没有进行新的部署、交易或协议修改。
