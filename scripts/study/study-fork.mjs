#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { provenance, root, writeJson } from "./common.mjs";

const rpcUrl = process.env.BASE_MAINNET_RPC_URL ?? "https://mainnet.base.org";
let requestId = 0;
async function rpc(method, params, url = rpcUrl) {
  const response = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  });
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const addresses = {
  usdc: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", source: "https://developers.circle.com/stablecoins/usdc-contract-addresses" },
  usdt: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", source: "Base deployed token bytecode; issuer provenance requires separate diligence" },
  poolManager: { address: "0x498581ff718922c3f8e6a244956af099b2652b2b", source: "https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts" },
  universalRouter: { address: "0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7", source: "https://github.com/Uniswap/universal-router/blob/main/deploy-addresses/base.json" },
  permit2: { address: "0x000000000022D473030F116dDEE9F6B43aC78BA3", source: "Uniswap canonical Permit2 deployment" },
  gasPriceOracle: { address: "0x420000000000000000000000000000000000000F", source: "https://docs.base.org/base-chain/network-information/base-contracts" },
};

try {
  const requestedForkBlock = process.env.ILAL_FORK_BLOCK;
  const finalized = await rpc("eth_getBlockByNumber", [
    requestedForkBlock ? `0x${BigInt(requestedForkBlock).toString(16)}` : "finalized", false,
  ]);
  const forkBlock = Number(BigInt(finalized.number));
  const codeEvidence = {};
  for (const [name, entry] of Object.entries(addresses)) {
    const code = await rpc("eth_getCode", [entry.address, finalized.number]);
    codeEvidence[name] = {
      ...entry, byteLength: (code.length - 2) / 2,
      sha256: createHash("sha256").update(Buffer.from(code.slice(2), "hex")).digest("hex"),
      present: code !== "0x",
    };
  }
  const fork = spawnSync("forge", ["test", "--match-contract", "InstitutionalNettingForkTest", "-vv"], {
    cwd: resolve(root, "contracts"), encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, BASE_MAINNET_RPC_URL: rpcUrl, ILAL_FORK_BLOCK: String(forkBlock) },
  });
  const forkPassed = fork.status === 0;
  const forkOutput = `${fork.stdout ?? ""}\n${fork.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
  const routerBaselines = [...forkOutput.matchAll(/FORKBASELINE\|[^\r\n]+/g)].map(match =>
    Object.fromEntries(match[0].split("|").slice(1).map(field => {
      const separator = field.indexOf("=");
      const value = field.slice(separator + 1);
      return [field.slice(0, separator), /^\d+$/.test(value) ? Number(value) : value];
    })),
  );
  let representativeL1FeeWei = null;
  let l1FeeStatus = "NOT_RUN";
  try {
    const sepoliaRpc = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
    const txHash = "0x4dc0493ea84caeef1dc4f4e8ce4ed3598cd23985ba64f58fbde0ee0c67d6dfa9";
    const rawTx = spawnSync("cast", ["tx", txHash, "raw", "--rpc-url", sepoliaRpc], { encoding: "utf8" });
    const raw = rawTx.status === 0 ? rawTx.stdout.trim() : null;
    if (raw) {
      const call = spawnSync("cast", ["call", addresses.gasPriceOracle.address,
        "getL1Fee(bytes)(uint256)", raw, "--rpc-url", rpcUrl, "--block", String(forkBlock)],
      { encoding: "utf8" });
      if (call.status === 0) {
        representativeL1FeeWei = call.stdout.trim().split(/\s+/)[0];
        l1FeeStatus = "COMPLETE";
      }
    }
  } catch {}

  let productionEconomicGate = { status: "NOT_RUN", reason: "local anchor or Base L1 fee unavailable" };
  try {
    const local = JSON.parse(readFileSync(resolve(root, "docs/research/results/local-study.json"), "utf8"));
    const anchor = local.scenarios.find(item => item.scenarioId === "econ-scaled-10000-70-5bps");
    const cheapest = routerBaselines.filter(item => item.mode === "bundled" || item.mode === "independent")
      .sort((left, right) => left.totalGas - right.totalGas)[0];
    if (anchor?.baselines?.ilal?.succeeded && cheapest && representativeL1FeeWei !== null) {
      const outputAdvantageUsd = (anchor.baselines.ilal.outputRaw - cheapest.output) / 1e6;
      const gasPremium = Math.max(0, anchor.baselines.ilal.totalGas - cheapest.totalGas);
      const l2PremiumUsd = gasPremium * 1e-9 * 3000;
      const candidateL1FeeUsd = Number(representativeL1FeeWei) / 1e18 * 3000;
      const solverReserveUsd = 17_000 * 0.5 / 10_000;
      const netBenefitUsd = outputAdvantageUsd - l2PremiumUsd - candidateL1FeeUsd - solverReserveUsd;
      productionEconomicGate = {
        status: netBenefitUsd > 0 ? "PASS" : "FAIL", baseline: `universal-router-${cheapest.mode}`,
        outputAdvantageUsd, gasPremium, l2PremiumUsd, candidateL1FeeUsd,
        solverReserveUsd, netBenefitUsd,
        conservativeNote: "Charges the full candidate L1 fee and credits no L1 fee to vanilla, understating ILAL net benefit.",
      };
    }
  } catch {}

  const missingCode = Object.values(codeEvidence).filter(item => !item.present);
  const result = {
    schema: "institutional-study-v1", study: "fork",
    provenance: provenance({ chainId: 8453, forkBlock, forkBlockHash: finalized.hash }),
    status: forkPassed && missingCode.length === 0 && routerBaselines.length === 2 && l1FeeStatus === "COMPLETE" ? "COMPLETE" : "PARTIAL",
    addresses: codeEvidence,
    scenarios: routerBaselines.map(item => ({ scenarioId: `fork-universal-router-${item.mode}-10000-70-5bps`,
      category: "production-router-baseline", ...item, fullFill: true })),
    baseFeeModel: {
      source: "https://docs.base.org/base-chain/network-information/network-fees",
      components: ["L2 execution", "L1 security"],
      representativeCandidateTransaction: "0x4dc0493ea84caeef1dc4f4e8ce4ed3598cd23985ba64f58fbde0ee0c67d6dfa9",
      l1SecurityFeeStatus: l1FeeStatus, representativeL1FeeWei,
    },
    baselines: {
      directV4: "MEASURED_LOCAL",
      universalRouterPermit2: routerBaselines.length === 2 ? "MEASURED_ON_PINNED_BASE_FORK" : "NOT_RUN",
      note: "Official deployed router and Permit2 execute against a controlled vanilla pool on the official PoolManager with real USDC/USDT bytecode.",
    },
    gates: [
      { id: "fork-code-surface", status: forkPassed && missingCode.length === 0 ? "PASS" : "FAIL" },
      { id: "official-universal-router-full-fill", status: routerBaselines.length === 2 ? "PASS" : "FAIL" },
      { id: "production-economic-gate", ...productionEconomicGate },
    ],
    findings: [],
    verdict: productionEconomicGate.status === "FAIL" ? "FAIL" : productionEconomicGate.status === "PASS" ? "PASS" : "CONDITIONAL",
    forkTestOutput: forkOutput.slice(-4000),
  };
  const path = writeJson("fork-study.json", result);
  process.stdout.write(`wrote ${path}\nfork block ${forkBlock}; contract surface ${forkPassed ? "passed" : "failed"}\n`);
  if (!forkPassed || missingCode.length) process.exitCode = 1;
} catch (error) {
  const result = {
    schema: "institutional-study-v1", study: "fork", provenance: provenance({ chainId: 8453, forkBlock: null }),
    status: "ERROR", scenarios: [], gates: [{ id: "fork-available", status: "FAIL" }],
    findings: [{ id: "P1-FORK-RPC", severity: "P1", status: "open", title: String(error) }], verdict: "FAIL",
  };
  writeJson("fork-study.json", result);
  console.error(error);
  process.exitCode = 1;
}
