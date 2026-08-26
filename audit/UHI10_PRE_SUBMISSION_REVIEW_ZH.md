# ILAL UHI10 提交前静态安全与机制 Review

日期：2026-08-26  
审查对象：`origin/main` `8e634c54458f13c5b4a1257266664438100a35d6`  
链上 candidate 源码基线：`a512e6996735ab83d088a80723d30e4f7bb897a9`  
性质：第一方提交前静态 review；**不是独立审计**

## Executive verdict

**Hookathon：CONDITIONAL GO。** 本轮未发现明显 P0/P1，也没有发现需要立即停止
提交的资金盗取、签名绕过、nonce replay、跨池 replay 或半结算路径。当前
`P0 = 0 / P1 = 0` 与本轮核心代码复核一致。

**Production：NO-GO。** 独立审计、机制公平性改造、真实资产/feed 绑定、连续
价格边界和仓库保护仍未完成。

提交前建议：**不要仓促改变当前 candidate bytecode**。先修正所有超过代码
保证范围的公开表述，保留现有 Base Sepolia exact-match 证据。任何 Solidity
修复都必须重新部署、重新 exact-match、重跑 2/4/16-order 与研究门禁后，才能
替换当前 candidate。

## Snapshot verification

- `a512e69…` 到 `8e634c5…` 的 `*.sol` diff 为空；当前 `main` 的核心合约与链上
  candidate 源码一致。
- Chainlink candidate manifest 记录的 `sourceCommit` 为 `a512e69…`。
- 聚焦回归 `4 passed / 0 failed`：canonical fixed-set permutation、完整 slippage
  rollback、`100/70` residual pool equivalence、oracle-before-mutation。
- Chainlink Guard 单元套件通过。
- GitHub API 在 review 时返回 `main.protected = false`。

## Findings summary

| ID | Severity | Finding | Hookathon 处置 |
|---|---|---|---|
| ILAL-UHI-01 | P2 | signer-controlled nonce 可 grind `orderHash`，影响顺序匹配优先级 | 立即收紧 claim；提交后做 pro-rata |
| ILAL-UHI-02 | P2 | raw-unit 1:1 clearing 不使用 oracle ratio | 明确 narrow stablecoin 假设；不要泛化到 RWA |
| ILAL-UHI-03 | P2 | tick/oracle 只在 openBatch 检查，residual 使用全局价格极限 | 保留 limitation；提交后加协议级 band |
| ILAL-UHI-04 | P2 operational | Guard 未在合约层绑定 token/feed；hUSDT 使用 USDT reference feed | Demo 可用；production blocker |
| ILAL-UHI-05 | P3 | immutable EIP-712 separator 缓存部署时 chain ID | 提交后 harden |
| ILAL-UHI-06 | P3 | v1/v2 ComplianceHook constructor hardening 不一致 | 提交后 harden |
| ILAL-UHI-07 | P3 docs | 可复用的是 eligibility grant，不是同一个 action token | 立即修正文案 |
| ILAL-UHI-08 | P2 operational | `main` 未启用 branch protection | Owner 在提交/试点前配置 |

---

## ILAL-UHI-01 — Nonce grinding can influence sequential match priority

**Severity:** P2 / mechanism fairness  
**Status:** Confirmed  
**Affected:**
[`NettingTypes.sol`](../contracts/src/netting/NettingTypes.sol),
[`InstitutionalNettingHook.sol`](../contracts/src/netting/InstitutionalNettingHook.sol),
[`InstitutionalBatchRouter.sol`](../contracts/src/netting/InstitutionalBatchRouter.sol)

### Impact

`NettingOrder.nonce` 是 signer 自选的 `bytes32`，并进入 `orderHash`。Router 按
hash 升序排序；Hook 再按同一顺序，以 `min(amountIn, remainingMatch)` 逐单分配。
当同方向存在多个订单且 opposing flow 不足时，较早订单得到更多内部 1:1
matching，较晚订单承担更多 AMM residual。

因此协议当前保证的是：

> 对一个固定的已签名订单集合，solver 无法通过重新排列改变结果。

协议不保证：allocation strategy-proof、time-priority、signer 无法影响优先级，
或 solver 无法通过 batch inclusion/exclusion 影响结果。

已有 `maxAmmInput` 和 `minAmountOut` 会保护用户签署的边界，因此这不是无条件
资产盗取；它是 Fair Flow 机制与经济公平性风险。

### Attack / strategy scenario

同方向有 `60` 与 `40` 两笔订单，反方向可匹配 `70`。若 `60` 排在前面，它
得到 `60 matched`，`40` 订单得到 `10 matched + 30 AMM`；顺序相反时，`40`
全部 matched，而 `60` 得到 `30 matched + 30 AMM`。

### PoC logic

使用与 CLI/合约相同的 EIP-712 struct hash，在固定其他字段时扫描 256 个 nonce：

```text
fixed 40-unit order hash:
0xe6ab3317071ec82d3946872455a8bedf4fe1e66985cdfbd8c5a36f4e54401e97

60-unit order, nonce 1:
0x37f6cb863a8483a36bbaebdc8ed437bc49d99b1b4054be4f3d07524163825177
→ before fixed order

60-unit order, nonce 5:
0xf2e3356be75f2e1c062714747833f4ac3a0a770828d6bbb58841848129237ca0
→ after fixed order

best of 256, nonce 212:
0x00816a75f14a00482a509091550f2e291c35959eea5564d2aac6086c221192aa
```

同一个 signer 可以在签名前选择让自己的订单落在固定订单之前或之后。

### Recommendation

提交后将同方向 matching 改为 cumulative pro-rata：

```text
targetAfter = floor(cumulativeInputAfter * matchedEachSide / totalSide)
matchedThis = targetAfter - targetBefore
```

该方法保证总 matched 精确闭合，并把排序影响限制在最多极小 raw-unit rounding
dust。新增测试必须覆盖 nonce grinding、solver inclusion、同方向 2–8 订单和
所有 remainder 分配。

### Hookathon decision

**不改当前 bytecode。** 立即删除 `pro-rata`、`fair ordering`、`strategy-proof`
等不真实表述，只使用：

> deterministic, permutation-independent allocation for a fixed signed set

---

## ILAL-UHI-02 — Raw-unit 1:1 clearing assumes economic parity

**Severity:** P2 / economic design  
**Status:** Confirmed

### Impact

内部 match 固定为等 decimals 的 raw-unit `1:1`。Chainlink Guard 只决定 batch
能否打开，不参与 clearing price。`minAmountOut` 检查的是 matched 加 AMM 的总
token 输出，可以让不接受 1:1 的订单回滚，但不会生成补偿性的 oracle-ratio
成交数量。

在当前 `100 bps` pair boundary 内，两个资产仍可能存在接近 1% 的相对价值差。
例如：

```text
token0 = $0.9950
token1 = $1.0049
pair difference / smaller price ≈ 99.5 bps
```

该快照仍可通过当前 pair boundary，但 `1 token0 ↔ 1 token1` 不是价值中性成交。

### Recommendation

Production 设计至少选择一种：

1. 将 pair boundary 收紧到适合资产和 feed heartbeat 的 10–20 bps；
2. 在订单中加入 `minMatchedAmountOut` 或 `maxInternalPriceDeviationBps`；
3. 使用 oracle-ratio clearing，并完整处理 rounding 与 stale/reference risk。

### Hookathon decision

**保留当前 narrow MVP，不改 bytecode。** 公开材料必须明确：equal-decimal
stablecoin candidate、raw-unit 1:1、oracle 不是成交价格、用户必须明确接受
该 clearing rule；不能泛化为 arbitrary RWA execution。

---

## ILAL-UHI-03 — Opening guard does not enforce the ending price band

**Severity:** P2 / liveness and market-safety boundary  
**Status:** Confirmed and already partially documented

### Impact

`openBatch()` 在 nonce/资产变化前验证 Chainlink 与 opening tick，随后 residual
swap 使用 `MIN_SQRT_PRICE + 1` 或 `MAX_SQRT_PRICE - 1`。因此 opening tick 合格
不代表 ending tick 仍在 `±100`。只要用户的 signed limits 允许，一个 batch 可
把池推离 operating band，导致后续 batch 被拒绝，直到外部流动性或交易恢复
价格。

这不会绕过用户的 `minAmountOut` / `maxAmmInput`，但安全区目前依赖 candidate
的 wide + stabilizer liquidity configuration，不是合约 invariant。早期 aborted
candidate 从 tick `0` 移到 `-591` 已经证明该边界实际存在。

### Recommendation

- 根据方向用 `TickMath.getSqrtPriceAtTick(±maxAbsTick)` 设置真实
  `sqrtPriceLimitX96`；
- 在 `closeBatch()` 再检查 ending tick；
- 保持 exact-input complete-fill requirement，使触碰 band 的 partial fill 原子
  回滚；
- 增加 batch 内多 residual leg、boundary touch 与 state-race 回归。

### Hookathon decision

**不改当前 bytecode。** README/runbook 已称其为 batch-opening guard；官网和
Pitch 必须继续使用相同措辞，不说 continuous price protection。

---

## ILAL-UHI-04 — Feed configuration is not cryptographically bound to assets

**Severity:** P2 operational  
**Status:** Confirmed

### Impact

Guard 保存 `feed0/feed1`，Hook 保存 `token0/token1`，但两个合约之间没有 token
到 feed 的可验证绑定。部署者可误配 feed。当前 Base Sepolia 的 token1 是 ILAL
测试表示 `hUSDT`，Guard 读取官方 USDT/USD reference feed；这证明 Chainlink
plumbing 与 fail-closed 路径，不证明 hUSDT 本身未脱锚。

### Recommendation

- Production deployment manifest/registry 必须显式绑定 token、feed、description、
  decimals、heartbeat、code hash 与治理批准；
- 使用与实际 supported asset 对应的官方 feed；
- deployment/preflight 校验该绑定，而不是只校验 feed 有 code；
- 将 feed rotation 设计为 timelocked、可审计的迁移。

### Hookathon decision

Demo 可接受，但只能称：

> Chainlink reference-feed integration as a fail-closed safety gate

不能称 Chainlink 证明 hUSDT 的真实 market price。

---

## ILAL-UHI-05 — EIP-712 separator caches deployment chain ID

**Severity:** P3 / informational  
**Status:** Confirmed

`InstitutionalNettingHook`、v1 和 v2 ComplianceHook 在 constructor 中使用
`block.chainid` 一次性计算 immutable domain separator。链发生 chain ID 变化
后，旧 domain 仍生效。Base 正常运营下概率很低，但 hardened EIP-712 实现通常
缓存 deployment chain ID 并在变化时重算，或使用 OpenZeppelin `EIP712`。

**Decision:** 非 Hookathon blocker；下一次 bytecode revision 统一修复。

---

## ILAL-UHI-06 — Legacy ComplianceHook constructors are less hardened

**Severity:** P3  
**Status:** Confirmed

Netting Hook 会验证 PoolManager/Registry/Guard/Router code、token pair、decimals、
pool config 与 Hook permission bits。v1 `ComplianceHook` 直接保存 constructor
参数；v2 只做 non-zero check。错误部署可能产生永久 misconfigured immutable
Hook。

**Recommendation:** 同步 code-length、router、permission-mask 和关键 config
校验。非当前 SOEE candidate runtime exploit，下一次版本修复。

---

## ILAL-UHI-07 — Eligibility grants are reusable; action tokens are one-time

**Severity:** P3 documentation  
**Status:** Confirmed

每个 `SessionToken` 绑定 action/deadline/nonce，成功后 nonce 被消费。同一 token
不能复用。v2 可复用的是 proof 激活后的 short-lived eligibility grant；后续每个
action 仍使用 scoped one-time authorization。

推荐统一表述：

> Prove eligibility once, reuse the short-lived eligibility grant, and
> authorize each action with a scoped one-time token.

---

## ILAL-UHI-08 — `main` has no branch protection

**Severity:** P2 operational / supply chain  
**Status:** Confirmed through GitHub API on 2026-08-26

当前 `main` 可绕过重型 CI 直接 push，与 institutional-pilot 级验证不匹配。

**Recommendation:** 在合并当前必要 PR 后配置：require PR、require `verify`、
require branch up to date、block force push，并优先要求至少一名 reviewer。该动作
会改变 GitHub repository policy，应由 owner 明确执行。

---

## Submission decision matrix

### 提交前必须做，不改变 bytecode

- [x] 将官网 `pro-rata` 改为 canonical sequential allocation。
- [x] 将 solver-independence 限定为 fixed signed set 的 permutation independence。
- [x] 明确 raw-unit 1:1、batch-opening-only 和 hUSDT reference-feed 限制。
- [x] 明确 reusable grant / one-time action token。
- [ ] Owner 启用 `main` branch protection。
- [ ] 用最终 Pitch 再做一次 4:15 真人计时与 claim review。

### Hookathon 提交前不要仓促改

- pro-rata/cumulative allocation；
- oracle-ratio clearing 或新增 signed internal-price field；
- in-batch/final tick hard boundary；
- feed/token binding；
- EIP-712 与 legacy constructor hardening。

以上都会改变 bytecode 或部署结构。除非仍有足够时间从最终 commit 重新部署、
exact-match、跑完整证据集，否则应进入 post-Hookathon hardening branch。

### Institutional pilot 与 production

- **Controlled Base Sepolia pilot:** CONDITIONAL；仅按已记录 operating envelope。
- **Institutional mainnet pilot:** NO-GO，直到 ILAL-UHI-01/02/03/04 有明确设计
  处置、mainnet sequencer feed 配置、独立审计和治理/运维门禁完成。
- **Production-ready:** NO-GO。

## Positive observations

- EIP-712/low-s ECDSA/ERC-1271 与 user-scoped nonce bitmap 设计扎实；
- order 绑定 pool、domain 绑定 Hook，且 Hook immutable 绑定 Router/token pair/
  PoolManager；
- Hook 不信任 Router bookkeeping，会重建 commitment 并在 close 时核对所有总量；
- signature、policy、credential、oracle、tick、AMM limit、partial fill、slippage
  任一失败均处于同一 unlock 原子回滚域；
- 100k stateful calls、conservation、closed context、zero inventory 和 nonce rollback
  为当前安全结论提供了实证支持。

## Final assessment

| Area | Score |
|---|---:|
| Contract implementation | 9.1 / 10 |
| Security design | 8.7 / 10 |
| Mechanism fairness | 8.0 / 10 |
| Hookathon readiness | 9.4 / 10 |
| Production readiness | 6.5–7.0 / 10 |

最终结论：**可以提交 Hookathon，但必须使用窄而准确的 Fair Flow claim。** ILAL
已经证明 fixed-set canonical execution、原子 netting 和 residual-only AMM
exposure；尚未证明 allocation strategy-proof、oracle-priced internal clearing 或
continuous in-batch peg enforcement。
