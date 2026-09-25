# ILAL UHI10 官网顺序讲解稿

目标时长：**4:20–4:40**。硬停止：**4:50**。官网不作任何演示专用改动，严格按照网页当前从上到下的顺序讲。

演示画面只有三种：官网、机构操作台、BaseScan。操作完成后回到官网离开的位置，继续向下。

## 录制前

- 标签页 1：`https://www.ilal.tech/`
- 标签页 2：`https://www.ilal.tech/app.html`，钱包与 Base Sepolia 已连接
- 标签页 3：SOEE 成功交易 `0x6c2dbee372a3a88e0e8fe4e5cd15bf64389a9a4e6ebc6f03cce15ba0e620c72a`
- 官网从顶部开始；浏览器缩放 90%–100%；关闭无关标签页。
- 操作台预先准备可匹配的相反方向订单。不要在录像中等待另一家机构。

---

## 01｜Hero · `#top` · 0:00–0:25

画面：原官网首屏，标题与 100 / 70 / 140 / 30 状态框同时可见。

> Institutional trading repeats two costs: proving the same eligibility and sending offsetting flow through the market.
>
> ILAL removes both. Scoped access authorizes verified flow; SOEE nets opposing orders before the AMM.
>
> One hundred meets seventy. One hundred forty settles internally. Only thirty reaches Uniswap v4.

动作：正常向下滚动。

## 02｜Live proof · `#proof` · 0:25–0:49

画面：Chainlink-guarded netting evidence 卡片和底部结论。

> This is working evidence, not future architecture.
>
> The institution-app batch is public, the Hook source is exact-matched, and forward and reverse cases are linked. Here, 0.14 settled internally; only 0.03 USDC reached the AMM.

动作：继续向下。

## 03｜Institutional study · `#institutional-study` · 0:49–1:04

画面：Pressure tested 与研究数据区域，不逐项读完。

> We publish the economic boundary too: where netting creates strict benefit, where gas or liquidity limits capacity, and what remains unsupported.

动作：继续向下。

## 04｜Chainlink · `#chainlink` · 1:04–1:27

画面：三张 Chainlink 卡片。

> Before assets move or nonces are consumed, the Hook checks Chainlink reference feeds.
>
> They must be fresh, close to one dollar, and mutually consistent. Any failure or depeg stops the batch.
>
> Chainlink opens the safety boundary; it does not set execution price. Signed user limits remain binding.

动作：继续向下。

## 05｜Customers · `#customers` · 1:27–1:52

画面：Institutional trader、Market maker、RWA issuer。

> Institutions sign bounded orders locally. Permissionless solvers submit canonical batches. RWA issuers retain eligibility control without custody.
>
> Session reduces repeated access verification. SOEE reduces repeated market execution. They are separate Base Sepolia candidates today.

动作：继续向下。

## 06｜Product suite · `#product` · 1:52–2:13

画面：Hook、CNFIssuer、BatchRouter、CLI、Security package。

> During UHI10, we built the Netting Hook, atomic Batch Router, canonical allocation, residual-only v4 execution, Chainlink guard, and institution-facing CLI workflow.
>
> The implementation is backed by 282 Solidity tests, 56 CLI tests, 18 SDK tests, and 100,000 stateful invariant handler calls.

动作：继续向下。

## 07｜Problem · `#problem` · 2:13–2:32

画面：四个问题卡片以及 ILAL's answer。

> Institutions rarely use a public DEX interface. They integrate through treasury or order-management systems.
>
> Yet gross routing creates avoidable impact, discretionary ordering changes outcomes, generic intents miss final eligibility, and off-chain netting adds custody.

动作：继续向下。

## 08｜How it works · `#how` · 2:32–3:03

画面：四步流程，随后停在 170 → 140 → 30。

> ILAL uses four atomic steps.
>
> Verify policy and CNF eligibility. Sign a bounded EIP-712 order. Sort the fixed set by hash. Then before-swap return deltas net opposing flow and route only the residual through Uniswap.
>
> One Pool Manager unlock. All or nothing. Zero protocol inventory afterward.

动作：现在切换到已打开的机构操作台标签页。

## 09｜机构操作台 · 3:03–3:43

画面：`app.html`，使用 Netting 模式。

> This simulates the treasury interface an institution builds on our CLI or SDK—not a consumer DEX.
>
> The institution selects Netting, reviews the internal match and market exposure, then signs locally. The solver cannot rewrite its limits.

现场操作：

1. 保持 **Netting** 模式；
2. 展示 `You pay`、`You receive at least`、internal match、market exposure；
3. 点击 **Review institutional swap**；
4. 快速展示 Policy、CNF、nonce、deadline 和 execution limits；
5. 点击签署；
6. 展示 `Matched · ready to settle` 或已准备好的 settlement review；
7. 不等待新的对手方，不在录像时依赖测试网即时出块。

继续讲：

> The CLI exposes the same preflight step by step. Now I’ll show the confirmed public settlement.

动作：切换 BaseScan 标签页。

## 10｜BaseScan · 3:43–4:03

画面：状态 Success、交易哈希、调用目标。

> This is the Base Sepolia transaction—not a frontend simulation.
>
> Two signed orders settled atomically: 0.14 matched internally; only 0.03 USDC reached the AMM. Nonces were consumed, user limits held, and no protocol inventory remained.

动作：回到官网，回到刚才 `#how` 之后的位置，继续向下。

## 11｜RWA issuers · `#issuers` · 4:03–4:16

画面：Your policy. Your users. Your control.

> Issuers control who may enter the pool, while execution remains non-custodial. ILAL controls how verified flow reaches liquidity.

动作：继续向下。

## 12｜CLI · `#cli` · 4:16–4:29

画面：CLI 的逐步操作和命令表。

> Institutions can integrate through the CLI today: create and sign orders, preview and preflight the batch, execute, and cancel nonces.

动作：继续向下到 deployments；只停留最上方当前候选区域。

## 13｜Deployments and close · `#deployments` · 4:29–4:43

画面：Current public candidate 及链上链接。不要继续展开旧版本的所有交易。

> Every claim links to public code, contracts, and transactions. This is unaudited Base Sepolia software, but it is working and reproducible.
>
> ILAL does not create another liquidity venue. It makes existing Uniswap liquidity institution-ready.
>
> Verify access. Net what cancels. Send only the residual.

立刻停止。

---

## 现场故障降级

- **操作台订单显示 Waiting for match**：停留不超过 3 秒，说明 solver 等待反向合格订单，随后切成功的 BaseScan 交易。
- **MetaMask 没弹出**：不要刷新；直接切预先打开的成功交易。
- **BaseScan 加载慢**：回到官网顶部的 `#proof` 卡片完成证明。
- **3:50 时仍未回官网**：跳过 RWA issuers 和 CLI，直接进入 `#deployments` 收尾。
- **接近 4:45**：只说最后三句，不增加技术解释。

## 不可说错

- Session 与 SOEE 是两个独立候选，不能说成已经统一集成。
- Chainlink 是批次开启安全边界，不是成交价格来源。
- hUSDT 是测试表示，不声称 USDT/USD feed 是它的真实市场价格。
- 当前是 unaudited Base Sepolia candidate，不说 production-ready。
- 已确认交易不能描述成录像当场刚刚广播。
- README 中的 partner integration 只讲已存在代码和测试，不讲未来计划。
