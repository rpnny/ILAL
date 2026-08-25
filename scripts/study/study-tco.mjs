#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, resultsDir, root, writeCsv, writeJson } from "./common.mjs";

const rwaPath = resolve(resultsDir, "rwa-study.json");
const forkPath = resolve(resultsDir, "fork-study.json");
const rwa = JSON.parse(readFileSync(rwaPath, "utf8"));
let fork = null;
try { fork = JSON.parse(readFileSync(forkPath, "utf8")); } catch {}
const forge = spawnSync("forge", ["test", "--match-contract", "InstitutionalTcoStudy", "-vv"], {
  cwd: resolve(root, "contracts"), encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
});
const output = `${forge.stdout ?? ""}\n${forge.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
if (forge.status !== 0) throw new Error(output);
const line = output.match(/TCOGAS\|[^\r\n]+/)?.[0];
if (!line) throw new Error("TCO gas measurements missing");
const gas = Object.fromEntries(line.split("|").slice(1).map(field => {
  const [key, value] = field.split("=");
  return [key, Number(value)];
}));

const largest = rwa.scenarios.filter(item => item.category === "issuer-base").sort((a, b) => b.walletCount - a.walletCount)[0];
if (!largest) throw new Error("RWA base measurement missing");
const l1FeeWeiPerTx = Number(fork?.fees?.representativeL1FeeWei ?? 0);
const rows = [];
for (const churnPercent of config.rwa.monthlyChurnPercent) {
  const changed = Math.max(1, Math.floor(largest.walletCount * churnPercent / 100));
  const churn = rwa.scenarios.find(item => item.scenarioId === `rwa-churn-${largest.walletCount}-${churnPercent}`);
  const observedStaffHours = Math.max(0.25, Math.ceil((churn?.durationMs ?? largest.timingsMs.total) / 900_000) * 0.25);
  for (const staffRate of config.rwa.staffCostUsdPerHour) {
    for (const ethUsd of config.economic.ethPriceUsd) {
      for (const l2Gwei of config.economic.l2GasPriceGwei) {
        for (const path of ["ilal-v1-cnf-eas", "ilal-v2-zk-policy-grant", "benchmark-only-onchain-allowlist"]) {
          let issuerGas;
          let userGas;
          let transactions;
          if (path === "ilal-v1-cnf-eas") {
            issuerGas = gas.v1Attestation * changed;
            userGas = gas.v1Mint * changed;
            transactions = changed * 2;
          } else if (path === "ilal-v2-zk-policy-grant") {
            issuerGas = gas.v2Policy;
            userGas = gas.v2Grant * changed;
            transactions = changed + 1;
          } else {
            issuerGas = gas.allowlistWrite * changed;
            userGas = 0;
            transactions = changed;
          }
          const gasUsd = value => value * l2Gwei * 1e-9 * ethUsd;
          const l1Usd = transactions * l1FeeWeiPerTx / 1e18 * ethUsd;
          const staffUsd = observedStaffHours * staffRate;
          const issuerPaidUsd = gasUsd(issuerGas) + l1Usd + staffUsd;
          const userPaidUsd = gasUsd(userGas);
          rows.push({
            path, walletCount: largest.walletCount, churnPercent, changedWallets: changed,
            staffRateUsdPerHour: staffRate, ethPriceUsd: ethUsd, l2GasPriceGwei: l2Gwei,
            measuredIssuerGas: issuerGas, measuredUserGas: userGas, transactionCount: transactions,
            observedAutomationHoursProxy: observedStaffHours, staffCostUsd: staffUsd,
            l1SecurityFeeProxyUsd: l1Usd, issuerPaidUsd, userPaidUsd,
            totalSystemCostUsd: issuerPaidUsd + userPaidUsd,
          });
        }
      }
    }
  }
}

const result = {
  schema: "ilal-parameterized-tco-v1", status: fork ? "COMPLETE" : "PARTIAL", walletCount: largest.walletCount,
  measuredGasPrimitives: gas,
  assumptions: {
    staffTime: "Observed automated churn wall time is used as an operator-time proxy; it is not a customer staffing claim.",
    l1Fee: fork ? "The full serialized candidate transaction L1 fee is applied per modeled transaction as a conservative proxy, not an exact calldata quote." : "Fork evidence unavailable; L1 security fee is zero only as a marked partial CI estimate.",
    allowlist: "Benchmark-only mapping write excludes vendor, legal, database and integration overhead.",
  },
  l1FeeWeiPerTransactionProxy: l1FeeWeiPerTx, rows,
};
writeJson("tco-study.json", result);
writeCsv("tco-sensitivity.csv", rows, Object.keys(rows[0]));
rwa.tco = result;
writeFileSync(rwaPath, `${JSON.stringify(rwa, null, 2)}\n`);
process.stdout.write(`wrote ${rows.length} parameterized TCO rows\n`);
