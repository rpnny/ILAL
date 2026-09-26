> Historical document. For the maintained ILAL implementation and current commands, see [docs/HISTORY.md](../docs/HISTORY.md).

# UHI10 Feedback × ILAL 全量分析

日期：2026-09-18。代码基线：HEAD `453e404`，同时检查当前工作区已有的 CLI、Console、App 改动。反馈来源：用户提供的两页 Hookathon Feedback Form。本文是反馈驱动的架构、机制、产品和验证分析，不是逐行独立安全审计。

## 1. 核心结论

ILAL 的原子净额结算机制得到明确认可；当前最需要补齐的是内部成交定价，以及证明每类参与者在真实条件下受益的证据。

评委指出的 1:1 问题成立，已通过真实 PoolManager、真实 Hook/Router 的本地测试复现。它与零库存不变量不矛盾：资产数量守恒，并不能保证双方按合理价格交换。该问题在提交前审查 `ILAL-UHI-02` 已被记录，本次反馈说明它应从“已披露的 MVP 限制”升级为下一版机制工作的首要事项。

现有测试网 PoC 值得继续；现有证据不足以支持真实资金的生产就绪、所有用户获得更优成交、完整 Session + SOEE 集成、私密订单执行等更强结论。

本轮没有修改业务合约、前端或部署。新增本文和复现证据；临时测试文件运行后移出测试目录。未发交易、未联系评委。

## 2. 如何解读分数

| 维度 | 得分 / 5 | 可直接确认的含义 | 不能据此推出 |
|---|---:|---|---|
| Original Idea | 4 | 评委认可项目创意 | 净额撮合本身是全球首创 |
| Unique Execution | 4.5 | 明确认可 beforeSwap delta 和会计设计 | 所有机制、治理与安全问题已解决 |
| Impact | 3.5 | 五项中最低，真实影响是后续重点 | 评委已明确否定市场需求 |
| Functionality | 4.5 | 功能与实现得到高评价 | 获得独立审计或生产许可 |
| Presentation | 4 | 问题描述、数据突出和引用得到肯定 | 叙事顺序无需调整 |
| Total | 4.1 | 五项均分为 4.1 | 排名、获奖概率或与其他项目的比较 |

反馈没有逐项解释 Impact 扣分原因。本文关于对手方供给、净收益和机构集成的分析是结合项目得出的判断，不冒充评委原话。不能把 4.1/5 直接解释为项目“完成度 82%”。

## 3. 评委真正认可的实现

`InstitutionalNettingHook.sol:305` 分配 matched input；`:327` 返回正的 specified delta 与负的 unspecified delta。反向订单产生逐币种相反的 Hook delta，在整批内抵消。`closeBatch` 在 `:261` 起核对订单数、commitment、输入总量、匹配总量及剩余额度；Router 同一 unlock 中结算，失败整体回滚。

这不是仅靠 UI 展示的撮合：Hook 自己验证订单集合和结算路径，Router 执行实际 v4 swap，残余输入才进入池曲线。官方 Uniswap 文档也说明 return delta 可同时调整 Hook 和 Router 的债权债务并绕开原生曲线的一部分成交。[Uniswap Custom Accounting](https://developers.uniswap.org/docs/protocols/v4/guides/custom-accounting)

应该保留的工程资产：EIP-712/EOA/ERC-1271、逐用户 nonce、pool/domain 绑定、固定集合的 canonical ordering、完整输入与最低输出检查、oracle-before-mutation、守恒/零库存/回滚测试。

准确的零库存表述是“成功结算时 Hook 和 Router 不需保留代币库存，Hook 净债务闭合”。批内仍可存在临时债权债务，PoolManager 也必须有足够的实际余额支撑当时的 take；零库存不等于结算全过程无资金约束。

## 4. 价格问题的代码证据和量化

| 位置 | 当前行为 | 后果 |
|---|---|---|
| `contracts/src/netting/InstitutionalNettingHook.sol:229` | 读取 slot0 但丢弃 sqrtPriceX96，只检查 tick | 价格进入开批许可，未进入撮合报价 |
| `contracts/src/netting/NettingTypes.sol:69` 附近 | matched = min(total0,total1) | 默认两个 raw unit 等价 |
| `contracts/src/netting/InstitutionalNettingHook.sol:327` | 输入和输出 delta 绝对值相同 | 成交固定 1:1 |
| `contracts/src/netting/InstitutionalBatchRouter.sol:122` | Router 重复计算两侧相同匹配额度 | 修复不能仅改 Hook |
| `contracts/src/netting/InstitutionalBatchRouter.sol:181` | matched 作为 matchedOutput，余下当 AMM output | 非 1:1 后事件拆分也要更新 |
| `contracts/src/oracle/ChainlinkStablecoinOracleGuard.sol:104` 附近 | 检查 feed 的价格、新鲜度、脱锚与价差 | 不计算当前内部成交价格，也不比较池价与 feed ratio |

令 P 为每个 token0 对应的 token1 raw units；等 decimals 时也等于人类单位价格。Uniswap 的 sqrtPriceX96 表示 sqrt(P) × 2^96；tick 对应约 P = 1.0001^tick。实际成交应使用精确 sqrtPriceX96，不能用整数 tick 代替连续价格。[Uniswap TickMath 源码](https://github.com/Uniswap/v4-core/blob/main/src/libraries/TickMath.sol)

在精确 tick 90 的价格上：P = 1.009040167735959。

| 方向 | 输入 | 当前内部输出 | 按开批 spot 的理论输出 | 相对理论输出偏差 |
|---|---:|---:|---:|---:|
| token0 → token1 | 100 | 100 | 100.90401677 | 少约 89.59 bps |
| token1 → token0 | 100 | 100 | 99.10408247 | 多约 90.40 bps |

两侧偏差使用各自理论输出作分母，因此不完全相同。以上是相对开批 spot 的差异，不是实际 AMM 净报价；真实曲线成交还包含 5 bps 费率、价格冲击和整数舍入。tick 为负时受益与受损方向反转。

本轮复现把原有测试 fixture 的 PoolManager 直接初始化为 `TickMath.getSqrtPriceAtTick(90)`，再按原流程添加流动性、设置资格和签名交易，没有用只修改 tick 的不一致状态。

1. 双方输入 100、最低输出 100、maxAmmInput = 0：成交成功，各收 100，池价不变，Hook/Router 均零库存。
2. 将 token0 卖方最低输出提高至 100.8：`SlippageTooHigh`，整批回滚，两个 nonce 均未消耗。

由此确认：这是已签约束内的经济定价问题，不是现有证据下的任意资金盗取或签名绕过。宽松或错误参考价生成的签名可能接受不利价格；严格约束只能拒绝，不能替用户得到正确成交。

已有 `test_pegGuard_acceptsBoundaryAndRejectsBothSidesOutside` 通过 `_setPoolTick` 只修改 tick 位，没有同步 sqrtPriceX96。它适合验证门禁分支，不能充当非平价经济性测试。

## 5. 应如何理解并实现评委建议

评委建议使用 openBatch 读取的 sqrt price，方向合理。但“与 residual 相同价格”需要精确定义：按开批 spot 内部撮合，只保证统一参考基准；residual 沿 AMM 曲线成交，扣费后平均汇率通常不同。

建议下一版明确承诺：“内部匹配按开批时锁定的池价；剩余量按 AMM 实际结果结算；两部分分别披露，整笔仍受用户签名约束。”不承诺二者实际均价相等。

### 5.1 从相同数量改为按价值匹配

连续精度概念公式：

```
P = (sqrtPriceX96 / 2^96)^2
M0 = min(T0, T1 / P)
M1 = P * M0
R0 = T0 - M0
R1 = T1 - M1
```

例如 T0 = 100、T1 = 70、tick 90：M0 ≈ 69.37285773，M1 = 70，R0 ≈ 30.62714227。旧的“70 对 70，剩余 30”只在平价成立。

公式不是可直接粘贴的 Solidity 算法。整数实现必须明确：哪一侧限制匹配、floor/ceil 的方向、零输出小额订单、可接受价格误差、未匹配 dust 的归属和两侧是否允许极小 residual。不能独立对每笔 output 向下取整后，仍假设 Hook 恰好零债务。

逐币种必须严格成立：token0 的内部总输入 = token0 的内部总输出；token1 同理。若按累计比例分配，应对输入与输出预算分别分配并验证汇总，不能把同一个 matchedInput 继续当 output。多次比例舍入和拆单可能带来累计 dust，必须量化，而非声称天然无影响。

### 5.2 完整改动面

| 模块 | 所需改动 |
|---|---|
| BatchHeader / BatchContext | `matched0`、`matched1`、两币种 observed input/output、锁定价格与价格来源 |
| NettingTypes | 分离静态订单 commitment 和依赖市场状态的报价；重新定义 exposure 指标 |
| Hook openBatch | 锁定精确 sqrtPrice；校验报价上下界与必要的 pool/oracle 偏差 |
| Hook beforeSwap | 返回 `matchedInput` 与 `matchedOutput`，对两者分别检查 int128 安全 |
| Hook closeBatch | 逐币种闭合；检查 dust、剩余量及最终价格边界 |
| Router | 使用同一份权威匹配分配，更新事件、金额拆分和结算顺序 |
| Preview | 当前 pure preview 无法独立给出现时成交分配；改为显式价格输入或状态读取报价，执行时重新校验 |
| 订单签名 | 评估增加内部价格区间/最低内部输出、报价有效期；变更 schema 时更新 domain/version |
| CLI / App / Console | 更新 ABI、bigint 定价、输出拆分、报价区块与提示 |
| SDK | 当前主要导出 session/credential；若面向交易系统，应补版本化 netting 集成面 |
| Benchmark / manifest | 重算非平价收益、gas、容量、费率分配；发布新部署和新证据 |

使用 FullMath 等整数运算。当前 ±100 范围能约束数值，但如扩展范围，直接 uint256 平方 uint160 sqrt price 可溢出；不能使用浮点或没有误差证明的连续两次除法。

### 5.3 同期必须处理的机制边界

池价只是可执行参考，并非天然不可操纵的公允价。当前准入限制让普通外部地址不能任意绕过 Hook 交易，但有资格的交易、流动性变化、批次时机等仍会影响快照。需要针对实际可达路径测试价格移动，不能把 permissionless Router 等同于任何钱包可绕过资格。

当前 pool tick 和 oracle 各自接近 1，并不意味着彼此接近。例如池价约 1.01005、允许的 feed ratio 约 0.99010，两者相对偏离可约 2%。改为池价撮合后，应显式检查两种参考的差异和数据新鲜度。

pool–oracle 限制、用户最低输出、批内价格边界解决不同问题；仅缩小 ±100 可以减小偏差，却不能消除固定 1:1 定价错误。TWAP 或外部报价也有滞后、更新、信任和可用性成本，不宜未经设计就作为单一万能替代。

## 6. 对现有价值与收益结论的影响

**82.35% 是特定 100/70 平价案例的 AMM 输入减少比例。** 它不等于手续费降低 82.35%、价格冲击降低 82.35%、MEV 降低 82.35% 或订单隐私提高 82.35%。公开 calldata、签名订单和事件仍能暴露交易信息。

非平价下不能直接把 token0 与 token1 数量相加，称为经济价值。若统一使用开批 token1 计价：gross value = P×T0 + T1；residual value = P×R0 + R1；减少比例 = 1 − residual value/gross value。其含义仍是指定基准下的 AMM 输入敞口压缩。

**+4.12 bps benchmark 不因此自动作废，也不能直接推广。** 它依赖原始平价、稳定币等值、特定 liquidity/fee/order mix。tick 90 的个体报价偏差约 90 bps，量级高于 4.12 bps，但两者分母与对照不同，不能机械相减。需要按同一估值基准、同一初始状态、逐用户比较。

必须把“总输出看起来更多”与“每个机构都获得合理成交”分开。偏离平价时，将不同币种裸数量直接相加，可能掩盖赢家和输家之间的价值转移。

两份成本证据要区分：`BREAK_EVEN.md` 是早期简化气费分析，未含 L1、solver、延迟等；较新的 `ILAL_INSTITUTIONAL_STRESS_VALUE_REPORT_EN.md` 已含官方 Router/Permit2 fork、历史 L1 fee 和 solver reserve。不能错误地说项目完全没做这些研究。较新报告中的 $4.643 仍是历史固定场景结果，不是当前行情或真实客户净收益保证，本轮未重跑其 fork。

下一版经济实验要同时输出：每单净收益、两方向最差结果、分配偏差、池价与 oracle 偏差、撮合等待、取消和失败率、全部成本、LP 收益及 solver 收入。加入 0%、低比例和高度单边 flow；当前单方向 batch 会拒绝，需要产品层定义超时 fallback。

LP 方面，匹配量绕开曲线意味着少收这部分 LP fee；只有证明减少逆向选择、提高留存或残余收益能补偿，才能支持 LP 也受益。KYC 资格本身不证明订单低毒性，不能直接推导更低逆向选择。

## 7. 结合整个项目的成熟度

| 子系统 | 已有证据 | 仍需补齐 |
|---|---|---|
| SOEE | Hook、Router、签名、原子净额、测试网记录 | 非平价定价、分配公平、边界、资本容量 |
| Session / V2 | policy grant、Groth16 adapter、scoped action、独立 candidate manifest | 与 SOEE 的真实端到端集成和统一撤销语义 |
| 资格体系 | policy/CNF、过期/撤销/域绑定 | 真实 issuer 集成、职责和治理验证 |
| ZK | 隐藏 tier/country 的约束和 proof 路径 | 生产 ceremony、artifact provenance 和专门审计 |
| Oracle | fail-closed feeds、stale/depeg/round、可选 sequencer 检查 | token/feed 可验证绑定、正确生产参数、pool/feed 相对价格检查 |
| CLI | netting 签名、预览、模拟和执行逻辑，现有 56 测试 | 新价格 schema、跨端一致性、完整 integration SDK |
| App / Console | 本地 UI、订单、钱包流程；已有工作区实现 | quote 与限制清楚区分、非平价签名、独立 UI/安全验收 |
| 发布治理 | manifest、runbook、历史源码验证记录 | 新版源码/部署/报价一致性与统一审计范围 |

具体边界：

- SOEE 当前 `_validateOrder` 读取 V1 Policy/CNF，没有调用 V2 grant manager。README 和 V2 manifest 已正确承认两条独立 candidate；不可把并列演示称为已集成。
- Netting Hook 只启用 beforeSwap / beforeSwapReturnDelta，不能把另一个 ComplianceHook 的 LP 准入保证自动归给该池。需要明确机构产品控制的是交易者、LP，还是两者。
- 当前 V2 manifest 明确是测试 EOA、mock token、unsafe development ceremony；历史 v0.3.3 的 Safe 描述不能无条件套用于 V2 candidate。
- 100k 钱包/proof 性能研究证明的是 issuer 数据处理能力，不等于 100k 机构客户、RWA 成交流动性或 RWA 资产定价能力。
- 两个 candidate 和本地 UI 未提交改动应分清 source、release、deploy 三种状态；本轮只核对本地记录，没有重新验证远程链上现状。

## 8. 反馈之外的重要关联发现

**前端 quote 假设与合约同源。** `site/app.js:147` 的 `updateQuote()` 使用 input×(1−slippage) 计算 minimum，按用户允许 AMM 百分比显示 matched/residual。这是平价假设下的下限/限制，不是根据实际对手方和池价得出的成交预期。负方向报价也不能只复制输入金额。修复后应分别展示预计输出、最低输出、最大 AMM 输入、实际匹配量与报价区块；后续模拟结果不能倒过来使早先的静态展示成为市场报价。

**Canonical 不等于公平。** 固定签名集合排序可避免 solver 随意调换顺序；signer 仍可选 nonce 改变 orderHash，solver 可选择集合和时机。累计 pro-rata 能减少大额匹配优先权，但不能独自解决集合选择、拆单、残余逐腿价格冲击与舍入策略。

**开批 band 不等于全程 band。** Router 目前使用全局 sqrt price limit，合格开盘仍可能以出界收盘。连续边界、结束检查、触边 partial-fill 的原子回滚需要一起设计。

**零库存不等于无限吞吐。** 当前 `_settleOrder` 逐单立即 take，后面的反向输入未必已经到账，可能受到 PoolManager 实际余额约束。项目已有 fixed-depth 100k/70k 失败记录。可以评估先收齐输入再统一付款，但这会改变资金流、授权和失败路径，必须单独验证。

**“当前审计范围”文档已落后于 candidate。** `audit/ILAL_CURRENT_AUDIT_SCOPE.md` 日期为 7 月 22 日，主范围是 v0.3.3，并把 V2 描述为尚未部署，也没有完整纳入 SOEE/oracle；8 月 V2 manifest 已记录独立部署。`circuits/v2/README.md` 的初始候选措辞也应与后续 testnet 部分统一。研究报告的 “ready for institutional pilot” 应明确是何种受控试点，避免与提交前审查的 mainnet NO-GO 混读。

Console 代码可见 loopback 绑定、随机 session token 和 Origin 检查；本轮没有做浏览器渗透、DNS rebinding 或签名端到端测试，因此不据此授予桌面签名服务安全结论。

## 9. Impact 应怎样提高

最有说服力的下一步，是与一个可提供双向流的稳定币 desk / treasury 场景验证：资格明确的交易者，在约定撮合窗口内，能否持续获得扣除成本后的可接受执行。

需要真实验证的问题：谁提供反向流、愿意等多久、匹配率如何随时间窗口变化、资格集合是否过小、单边时如何 fallback、誰支付 gas/solver、客户为什么付费、LP 为什么提供 residual 流动性。

收入模型也要分清：SOEE 当前是 zero netting fee，V2 的 fee 机制和测试交易不等于 SOEE 已产生独立客户收入。应先测量收费后的客户净收益，再决定每笔服务费、solver fee 或企业集成收费。此为产品实验建议，不是融资或收益承诺。

建议试点验收至少记录：逐用户 VWAP/净收益、p50/p95 等待、成交/取消/回滚比例、真实 matching ratio、gas 与数据费、签名/撤销/过期路径、LP 净收益、issuer 运维耗时。具体阈值由合作方的执行政策确定，不能从单次 100/70 demo 推出。

## 10. Presentation 的具体调整

本地 V6 首屏是 “170 enters / Only 30 moves the market”，第 6 页才展示 100/70 分解。评委的建议直接对应这条阅读障碍：观众先记住了数字，却尚不知道两个方向和双边 gross 的含义。

建议顺序：`1 → 6 → 2 → 3 → 4 → 5 → 7 → 8 → 9 → 10 → 11`。这是建议，不假定本地 V6 就是评委看到的完全相同文件。

第二页用两种 token 标明：A 输入 100 token0，B 输入 70 token1；在平价示例中交换 70/70，双边 gross 内部匹配 140，token0 residual 为 30。不要说“凭空省出 140 资金”，也不要把两个币种单位隐藏。

开场可改为：“两家合格机构，一家换出 100，另一家反向换出 70。在这个平价例子里，70 对 70 可以直接结算，只有剩下的 30 需要进入 Uniswap 曲线。ILAL 把这个过程做成带签名约束的原子执行。”

随后再解释资格、签名、v4 delta 和数据。保留评委认可的数据引用与突出显示。市场总量只作背景；核心说服力应来自一个有边界、可复现的成交案例。

## 11. 执行优先级与验收

以下 P0/P1 表示下一阶段工作优先级，不是新发现漏洞的严重性评级。

| 优先级 | 工作包 | 验收条件 |
|---|---|---|
| P0 | 定价及整数会计设计 | ±90、±100、0、极小金额均有精确预算；逐币种零债务；保留签名边界 |
| P0 | Quote/签名同步设计 | App、CLI、Router、Hook 共享同一价格规则；过期/状态变化可拒绝；静态限制不冒充 quote |
| P1 | 同方向分配与 residual 公平性 | nonce/拆单/permutation 用例；明确仍保留的 solver 选择权 |
| P1 | pool/feed 偏差与连续 band | 正反方向触边、oracle 更新、批内多 residual 的完整回滚测试 |
| P1 | 经济研究重跑 | 逐用户与统一价值总量；多价格、多 matching ratio、真实费用与 LP 结果 |
| P1 | 证据与文档统一 | 当前审计 scope 覆盖实际 candidate；数据标明版本、区块和假设；调整 Pitch 页序 |
| P2 | Session 与 SOEE 集成 | 同一真实交易中 grant 激活/撤销/过期影响 netting，域和 pool 绑定不丢失 |
| P2 | 治理、issuer 和部署门禁 | 对应资产/feed、生产 ceremony、独立审计、生产 liveness 和角色交接 |

建议按依赖拆成小版本：先冻结定价/会计规格与复现用例，再完成一个可测的合约版本，然后更新报价端与证据。不要同时扩展任意 RWA、不同 decimals、多 fee tier 和 batch 超 16 笔，否则难以判断收益变化来自哪里。

新的 Hook 会改变 bytecode/address，PoolKey 包含 Hook 地址，因此需要新 pool 和流动性安排；不能把旧地址的成功记录当成新机制验证。发布后重新生成 commitment/ABI vectors、2/4/16-order、源码验证和收益结果。

## 12. 本轮验证与证据范围

| 检查 | 本轮结果 |
|---|---|
| PDF | 两页文字和渲染均已检查 |
| SOEE 单测 + invariant | 51 passed，0 failed |
| 所有非 Fork Foundry 套件 | 279 passed，0 failed，0 skipped |
| 专项 tick 90 复现 | 2 passed；证明现有行为和签名回滚，不表示已经修复 |
| CLI | build 成功，56 passed |
| SDK | 18 passed |
| Circuit oracle | 8 passed |
| Circuit V1 | 1 个有效 witness 接受，3 个跨域/版本错误 witness 拒绝 |
| Circuit V2 | 1 个有效 witness 接受，4 个 tier/country/domain/policy 错误 witness 拒绝 |

Foundry 使用当前默认 fuzz runs=256、invariant runs=16/depth=16；每个 invariant 报告 256 handler calls。本轮没有重跑历史 100,000-call 压测，不能把 README 历史数字写成本轮结果。非 Fork 279 与 README 历史 282 是不同执行集合，不能据此认定测试丢失。

未执行：远程 RPC fork 重测、链上余额/源码再次验证、完整 `make verify` 的发布/打包/供应链门禁、完整 UI 验收、独立合约/电路审计。源码和文档存在只能证明本地实现与历史记录，不替代这些检查。

证据目录：[uhi10-feedback-2026-09-18](evidence/uhi10-feedback-2026-09-18/)。`FeedbackPriceReview.t.sol.fixture` 保存完整测试 fixture，复现时临时复制到 `contracts/test/FeedbackPriceReview.tmp.t.sol`，运行：

```sh
forge test --root contracts --match-contract FeedbackPriceReviewTest --match-test testFeedback -vv
```

运行后删除该临时副本即可。该 fixture 基于当前源码，后续 ABI 变化应更新后再运行。

最终判断：项目值得继续推进；最有价值的增量是把已证明的原子净额机制升级为价格、分配、风险边界和报价流程一致的执行产品，再用真实双向订单流验证机构价值。
