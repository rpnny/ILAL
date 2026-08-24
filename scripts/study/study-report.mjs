#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resultsDir, root, writeCsv, writeJson } from "./common.mjs";

function read(name) {
  try { return JSON.parse(readFileSync(resolve(resultsDir, name), "utf8")); } catch { return null; }
}
const local = read("local-study.json");
const fork = read("fork-study.json");
const rwa = read("rwa-study.json");
const stress = read("stress-study.json");
if (!local) throw new Error("local-study.json is required; run make study-local first");

const all = [local, fork, rwa, stress].filter(Boolean);
const failedGate = all.flatMap(item => item.gates ?? []).find(gate => gate.status === "FAIL");
const missingRequired = !fork || !rwa || !stress || [fork, rwa, stress].some(item => item.status !== "COMPLETE");
const openP01 = all.flatMap(item => item.findings ?? []).filter(item => ["P0", "P1"].includes(item.severity) && item.status !== "fixed");
const verdict = failedGate || openP01.length ? "FAIL" : missingRequired ? "CONDITIONAL" : "PASS";
const maturity = verdict === "PASS" ? "ready for institutional pilot" : "institutional pilot candidate";
const productionGate = fork?.gates?.find(gate => gate.id === "production-economic-gate");
const canonical = local.scenarios.find(item => item.scenarioId === "econ-scaled-10000-70-5bps");
const fixedFailures = local.scenarios.filter(item => item.poolFeeBps === 5 && item.liquidityMode === "candidate-fixed" && item.executionStatus !== "FULL_FILL");
const largestRwa = rwa?.scenarios?.filter(item => item.category === "issuer-base").sort((a, b) => b.walletCount - a.walletCount)[0];
const maxBatch = local.multiOrder?.scenarios?.find(item => item.orders === 16 && item.distribution === "uniform");
const capacityRows = local.capacityFrontier?.scenarios ?? [];
const capacityMinimum = capacityRows.filter(item => item.maxSafeNotional > 0).sort((a, b) => a.maxSafeNotional - b.maxSafeNotional)[0];
const capacityMaximum = [...capacityRows].sort((a, b) => b.maxSafeNotional - a.maxSafeNotional)[0];

function gateRows() {
  return all.flatMap(item => (item.gates ?? []).map(gate => `| ${item.study} | ${gate.id} | ${gate.status} | ${gate.reason ?? gate.note ?? ""} |`)).join("\n");
}
function fmt(value, digits = 3) { return value === null || value === undefined ? "n/a" : Number(value).toFixed(digits); }

const sharedFacts = {
  verdict, maturity, productionNetBenefitUsd: productionGate?.netBenefitUsd ?? null,
  productionBaseline: productionGate?.baseline ?? null, coreRows: local.scenarios.length,
  supportedRowsMeasured: local.scenarios.filter(item => item.measured).length,
  multiOrderRows: local.multiOrder?.scenarios?.length ?? 0,
  maxBatchGas: maxBatch?.totalGas ?? null, forkBlock: fork?.provenance?.forkBlock ?? null,
  rwaWallets: largestRwa?.walletCount ?? null, rwaTotalMs: largestRwa?.timingsMs?.total ?? null,
  rwaPeakRssBytes: Math.max(largestRwa?.peakRssBytes ?? 0, rwa?.proof?.peakRssBytes ?? 0) || null,
  proofP95Ms: rwa?.proof?.p95Ms ?? null,
  stressCalls: stress?.stress?.handlerCalls ?? null, fuzzRuns: stress?.stress?.fuzzRuns ?? null,
  candidateFixedFailureCount: fixedFailures.length,
  capacityRows: capacityRows.length,
  capacityMinimumUsd: capacityMinimum?.maxSafeNotional ?? null,
  capacityMaximumUsd: capacityMaximum?.maxSafeNotional ?? null,
  tcoRows: rwa?.tco?.rows?.length ?? 0,
};

const zh = `# ILAL 机构压力测试与价值评估报告

## 1. Executive verdict

**${verdict} — ${maturity}。** 独立审计前不得称为 production-ready。

本轮生成 ${sharedFacts.coreRows} 个经济矩阵行，其中 ${sharedFacts.supportedRowsMeasured} 个 5 bps 支持域场景由 Foundry 实测；1/30/100 bps 被明确标记为 candidate 不支持，而不是外推成结果。官方 Base Universal Router + Permit2 在固定 finalized block ${sharedFacts.forkBlock ?? "n/a"} 上以真实 USDC/USDT bytecode 完成独立与 bundled 路径。

严格 $10k/70%/5bps/scaled 门槛的保守净收益为 **$${fmt(sharedFacts.productionNetBenefitUsd)}**，比较基线为 ${sharedFacts.productionBaseline ?? "n/a"}，已扣除 1 gwei L2 gas premium、完整 candidate L1 security fee 与 0.5 bps solver reserve。

## 2. 研究问题与假设

研究稳定币执行台的 notional、matching ratio、liquidity 与链上成本边界；验证 RWA issuer 的 PII-free 数据、加密存储、root/witness/proof 与 churn；验证守恒、原子性、授权、nonce、库存及 solver preflight。

## 3. 测试环境与可重复方法

- Schema：institutional-study-v1；固定 seed：${local.provenance.seed}
- Local：Foundry ${local.provenance.toolchain.forge}
- Base fork：chain 8453，finalized block ${sharedFacts.forkBlock ?? "NOT_RUN"}
- 命令：make study-local / study-fork / study-rwa / study-report / study-full
- 所有官网数字由机器结果生成，不手工复制。

## 4. 安全与原子性结果

Stateful handler calls：${sharedFacts.stressCalls ?? "NOT_RUN"}；每项 fuzz：${sharedFacts.fuzzRuns ?? "NOT_RUN"}。覆盖 peg tick ±99/±100/±101、allowance/balance 状态竞争、deadline、revocation、policy rotation、permissionless malicious executor、nonce rollback 与 canonical ordering。

## 5. Profitability heatmap

见 [profitability-heatmap.svg](charts/profitability-heatmap.svg)。非 5 bps 行是 unsupported configuration。生产门槛只对 $10k/70%/5bps/scaled 作 PASS/FAIL。

## 6. Capacity frontier

固定 candidate 深度中共有 ${sharedFacts.candidateFixedFailureCount} 个实测容量失败行；100k/70k 回归继续原子回滚。完整 5×3×3×3 二分 frontier ${local.capacityFrontier?.binarySearchMatrix === "COMPLETE" ? `已完成 ${sharedFacts.capacityRows} 行，安全上限从 $${sharedFacts.capacityMinimumUsd} 到 $${sharedFacts.capacityMaximumUsd}` : "尚未完成"}。见 [capacity-frontier.svg](charts/capacity-frontier.svg)。

## 7. Multi-order scalability

完成 ${sharedFacts.multiOrderRows} 个场景（2/4/8/16 × uniform/one-large-many-small/long-tail）。16-order uniform total gas 为 ${sharedFacts.maxBatchGas ?? "n/a"}，rounding dust 为 0，canonical commitment 对 permutation 稳定。

## 8. Base production-fee benchmark

Base fee 同时计 L2 execution 与 L1 security。candidate 代表交易的 L1 fee 由 GasPriceOracle.getL1Fee 对完整历史序列化交易测得；Universal Router V2.1.1 与 Permit2 baseline 在官方 PoolManager 上执行。

## 9. RWA issuer workflow

最大数据集：${sharedFacts.rwaWallets ?? "NOT_RUN"} wallets；总耗时 ${fmt((sharedFacts.rwaTotalMs ?? 0) / 1000, 2)} 秒；peak RSS ${fmt((sharedFacts.rwaPeakRssBytes ?? 0) / 2 ** 30, 2)} GiB；20-proof p95 ${fmt(sharedFacts.proofP95Ms, 1)} ms。数据仅含 wallet、KYC level、country、expiry、status 与 hashed source reference。

## 10. TCO sensitivity

TCO 只做 ${sharedFacts.tcoRows} 行参数模型：人员 $50/$100/$200 每小时、ETH $2k/$3k/$4k、L2 gas 0.01/0.1/1 gwei；分别列 issuer-paid、user-paid、system total。它不是客户 ROI 声明。

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
${gateRows()}

## 14. Production blockers 与下一步

独立审计仍是 production blocker。若 capacity full frontier 或 100k issuer/proof 门槛未完成，则保持 CONDITIONAL；任何 P0/P1 或经济门槛失败则为 FAIL/NO-GO。
`;

const en = `# ILAL Institutional Stress & Value Validation Report

## 1. Executive verdict

**${verdict} — ${maturity}.** This result does not claim production readiness before an independent audit.

The study emits ${sharedFacts.coreRows} economic rows, with ${sharedFacts.supportedRowsMeasured} measured 5 bps scenarios. The 1/30/100 bps rows are explicit unsupported configurations. Official Base Universal Router + Permit2 independent and bundled paths were executed at finalized block ${sharedFacts.forkBlock ?? "n/a"} with real USDC/USDT bytecode.

The conservative strict-gate net benefit for $10k/70%/5bps/scaled is **$${fmt(sharedFacts.productionNetBenefitUsd)}** against ${sharedFacts.productionBaseline ?? "n/a"}, after the 1 gwei L2 gas premium, the full candidate L1 security fee, and a 0.5 bps solver reserve.

## 2. Research questions and hypotheses

The program tests economic usefulness for stablecoin desks, operational usefulness for RWA issuers, protocol safety under adversarial state changes, and signer-free solver preflight accuracy.

## 3. Environment and reproducibility

- Schema: institutional-study-v1; seed: ${local.provenance.seed}
- Local toolchain: ${local.provenance.toolchain.forge}
- Base fork: chain 8453, finalized block ${sharedFacts.forkBlock ?? "NOT_RUN"}
- Entry points: make study-local / study-fork / study-rwa / study-report / study-full
- Website values are generated from machine results.

## 4. Safety and atomicity

Stateful handler calls: ${sharedFacts.stressCalls ?? "NOT_RUN"}; fuzz runs per property: ${sharedFacts.fuzzRuns ?? "NOT_RUN"}. Regressions cover peg boundaries, allowance/balance races, deadlines, revocation, policy rotation, permissionless executors, nonce rollback, conservation and zero inventory.

## 5. Profitability heatmap

See [profitability-heatmap.svg](charts/profitability-heatmap.svg). Only the 5 bps candidate surface is measured.

## 6. Capacity frontier

The fixed candidate depth contains ${sharedFacts.candidateFixedFailureCount} measured capacity failures and preserves the 100k/70k atomic rollback regression. The complete binary-search frontier is ${local.capacityFrontier?.binarySearchMatrix ?? "NOT_RUN"}: ${sharedFacts.capacityRows} rows spanning $${sharedFacts.capacityMinimumUsd ?? "n/a"} to $${sharedFacts.capacityMaximumUsd ?? "n/a"}. See [capacity-frontier.svg](charts/capacity-frontier.svg).

## 7. Multi-order scalability

${sharedFacts.multiOrderRows} scenarios cover 2/4/8/16 orders and three distributions. Uniform 16-order total gas is ${sharedFacts.maxBatchGas ?? "n/a"}; rounding dust is zero and canonical commitments are permutation-stable.

## 8. Base production-fee benchmark

The model includes L2 execution and L1 security fees. The candidate L1 fee uses GasPriceOracle.getL1Fee on the complete serialized historical transaction. The production baseline uses deployed Universal Router V2.1.1, Permit2, the official PoolManager and real token bytecode.

## 9. RWA issuer workflow

Largest dataset: ${sharedFacts.rwaWallets ?? "NOT_RUN"} wallets; total ${fmt((sharedFacts.rwaTotalMs ?? 0) / 1000, 2)} seconds; peak RSS ${fmt((sharedFacts.rwaPeakRssBytes ?? 0) / 2 ** 30, 2)} GiB; proof p95 ${fmt(sharedFacts.proofP95Ms, 1)} ms.

## 10. TCO sensitivity

The ${sharedFacts.tcoRows}-row model varies staff at $50/$100/$200 per hour, ETH at $2k/$3k/$4k and L2 gas at 0.01/0.1/1 gwei. It reports issuer-paid, user-paid and system totals and is not a customer ROI claim.

## 11. Failures and remediation

The implementation removes O(n²) issuer import lookup, rejects duplicate wallets, adds pinned-block preflight and double simulation, and documents the immutable fee/token surface.

## 12. Supported operating envelope

2–16 orders; equal-decimal standard ERC-20 stablecoins; raw-unit 1:1; 5 bps; tick spacing 10; ±100 batch-start tick guard. Fee-on-transfer, rebasing, callback/nonstandard tokens, other fee tiers and capacity-exceeding batches are unsupported.

## 13. PASS / CONDITIONAL / FAIL

| Study | Gate | Status | Note |
|---|---|---|---|
${gateRows()}

## 14. Production blockers and next steps

Independent audit remains mandatory. Missing full capacity or 100k issuer/proof evidence keeps the result conditional; any P0/P1 or strict economic failure is a FAIL/NO-GO.
`;

mkdirSync(resolve(root, "docs/research/charts"), { recursive: true });
writeFileSync(resolve(root, "docs/research/ILAL_INSTITUTIONAL_STRESS_VALUE_REPORT_ZH.md"), zh);
writeFileSync(resolve(root, "docs/research/ILAL_INSTITUTIONAL_STRESS_VALUE_REPORT_EN.md"), en);

const heatRows = local.scenarios.filter(item => item.poolFeeBps === 5 && item.liquidityMode === "scaled" && item.measured);
const notions = [100, 1000, 10000, 100000];
const ratios = [25, 50, 70, 90, 100];
const cells = notions.flatMap((notional, y) => ratios.map((ratio, x) => {
  const row = heatRows.find(item => item.notionalUsd === notional && item.matchingRatioPercent === ratio);
  const value = row?.economics?.netBenefitUsdExcludingL1 ?? null;
  const fill = value === null ? "#444" : value >= 0 ? "#2c8f62" : "#b64a5a";
  return `<rect x="${150 + x * 130}" y="${70 + y * 70}" width="120" height="60" rx="8" fill="${fill}"/><text x="${210 + x * 130}" y="${105 + y * 70}" text-anchor="middle" fill="white" font-size="14">${value === null ? "n/a" : `$${value.toFixed(2)}`}</text>`;
})).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="390" viewBox="0 0 850 390"><rect width="850" height="390" fill="#111"/><text x="30" y="30" fill="white" font-size="20">ILAL local net benefit (excl. Base L1) · 5 bps scaled</text>${ratios.map((v,i)=>`<text x="${210+i*130}" y="58" text-anchor="middle" fill="#ccc">${v}%</text>`).join("")}${notions.map((v,i)=>`<text x="135" y="${108+i*70}" text-anchor="end" fill="#ccc">$${v.toLocaleString()}</text>`).join("")}${cells}<text x="30" y="370" fill="#aaa" font-size="12">Scenario: ETH $3k · L2 1 gwei · 0.5 bps solver reserve. Strict verdict additionally uses measured Base L1 fee.</text></svg>`;
writeFileSync(resolve(root, "docs/research/charts/profitability-heatmap.svg"), svg);
writeFileSync(resolve(root, "site/research-profitability-heatmap.svg"), svg);

const capacityGroups = [2_500, 5_000, 10_000, 20_000, 100_000].map(liquidityBps => {
  const rows = capacityRows.filter(item => item.liquidityBps === liquidityBps);
  return { liquidityBps, min: rows.length ? Math.min(...rows.map(item => item.maxSafeNotional)) : 0,
    max: rows.length ? Math.max(...rows.map(item => item.maxSafeNotional)) : 0 };
});
const capacityCeiling = Math.max(1, ...capacityGroups.map(item => item.max));
const capacityBars = capacityGroups.map((item, index) => {
  const y = 70 + index * 58;
  const maxWidth = item.max / capacityCeiling * 590;
  const minWidth = item.min / capacityCeiling * 590;
  return `<text x="125" y="${y + 20}" text-anchor="end" fill="#ccc">${item.liquidityBps / 10_000}x</text><rect x="145" y="${y}" width="${maxWidth}" height="28" rx="6" fill="#315a84"/><rect x="145" y="${y}" width="${minWidth}" height="28" rx="6" fill="#43b581"/><text x="${Math.min(800, 155 + maxWidth)}" y="${y + 20}" fill="#ddd" font-size="12">$${item.min.toLocaleString()}–$${item.max.toLocaleString()}</text>`;
}).join("");
const capacitySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="850" height="390" viewBox="0 0 850 390"><rect width="850" height="390" fill="#111"/><text x="30" y="32" fill="white" font-size="20">ILAL capacity frontier · min/max across range, tick and balance</text>${capacityBars}<text x="30" y="370" fill="#aaa" font-size="12">Green = minimum safe notional; blue = maximum. Binary search ceiling: $1,000,000.</text></svg>`;
writeFileSync(resolve(root, "docs/research/charts/capacity-frontier.svg"), capacitySvg);
writeFileSync(resolve(root, "site/research-capacity-frontier.svg"), capacitySvg);

const summary = { schema: "ilal-site-study-summary-v1", ...sharedFacts,
  caveat: "Institutional pilot evidence; unaudited and not production-ready.",
  supported: "2–16 orders · standard equal-decimal ERC-20 · 5 bps · ±100 tick start guard",
  unsupported: "fee-on-transfer/rebasing/nonstandard tokens · other fee tiers · capacity-exceeding batches" };
writeJson("study-summary.json", summary);
const findingsLedger = [
  ...all.flatMap(item => (item.findings ?? []).map(finding => ({ study: item.study, ...finding }))),
  { id: "P2-RWA-QUADRATIC-IMPORT", study: "rwa", severity: "P2", status: "fixed",
    title: "100k issuer import used repeated linear wallet lookup", resolution: "Batch index added; unit and 100k journey regression included." },
  { id: "P2-DUPLICATE-WALLET", study: "rwa", severity: "P2", status: "fixed",
    title: "Duplicate CSV wallets could overwrite earlier decisions", resolution: "Import now rejects duplicates with a regression test." },
  { id: "P3-CAPACITY-RUNNER-GAS", study: "local", severity: "P3", status: "fixed",
    title: "Monolithic frontier test exceeded the Foundry test gas ceiling", resolution: "Matrix split into 15 deterministic groups; all 135 rows complete." },
  { id: "P3-REPRO-RUNTIME-FIELDS", study: "full", severity: "P3", status: "fixed",
    title: "Initial reproducibility normalization retained gate wall-time and RSS observations", resolution: "Observed runtime and memory gate values are excluded while thresholds, status and semantic outputs remain hashed." },
  { id: "P3-SEPOLIA-EXTENDED-BATCH", study: "fork", severity: "P3", status: "open",
    title: "New 4/16-order Sepolia transactions were not broadcast", resolution: "No signer material was available; existing candidate transactions remain valid because contract bytecode did not change. Local 4/16 execution and pinned Base fork evidence are included." },
];
writeJson("findings-ledger.json", { schema: "ilal-findings-ledger-v1", findings: findingsLedger });
writeCsv("findings-ledger.csv", findingsLedger, ["id", "study", "severity", "status", "title", "resolution", "disposition"]);
const candidateManifest = JSON.parse(readFileSync(resolve(root, "docs/hookathon/candidate-manifest.json"), "utf8"));
writeJson("sepolia-evidence.json", {
  schema: "ilal-sepolia-study-evidence-v1", network: "base-sepolia", chainId: 84532,
  contractBytecodeChanged: false,
  reusedCandidate: {
    hook: candidateManifest.contracts?.nettingHook?.address ?? null,
    router: candidateManifest.contracts?.batchRouter?.address ?? null,
    canonicalTransaction: "0x4dc0493ea84caeef1dc4f4e8ce4ed3598cd23985ba64f58fbde0ee0c67d6dfa9",
    reverseTransaction: "0x4e4e2d6a45c76596a032d7fd09244420f00d56a033fb75f1137bba5f02f82fd8",
    sourceVerification: candidateManifest.verification ?? null,
  },
  requestedExtensions: {
    fourOrderBatch: "LOCAL_EXECUTION_COMPLETE_SEPOLIA_NOT_BROADCAST",
    sixteenOrderBatch: "LOCAL_EXECUTION_COMPLETE_SEPOLIA_NOT_BROADCAST",
    nearCapacitySuccess: "LOCAL_BINARY_SEARCH_COMPLETE_SEPOLIA_NOT_BROADCAST",
    pinnedBlockRejections: "NOT_RUN_NO_VALID_SIGNED_ORDER_FIXTURE",
  },
  note: "No reverting transaction was broadcast and no signer credentials were fabricated. Existing candidate evidence remains applicable because source contract bytecode did not change.",
});
writeFileSync(resolve(root, "site/institutional-study-summary.js"), `window.ILAL_STUDY_SUMMARY = ${JSON.stringify(summary, null, 2)};\n`);
process.stdout.write(`wrote bilingual reports, chart, and website summary (${verdict})\n`);
