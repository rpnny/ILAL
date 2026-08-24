#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forge = spawnSync("forge", ["test", "--match-test", "testBreakEven_", "-vv"], {
  cwd: resolve(root, "contracts"),
  encoding: "utf8",
});

const output = `${forge.stdout ?? ""}\n${forge.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
if (forge.status !== 0) {
  process.stderr.write(output);
  process.exit(forge.status ?? 1);
}

const lines = [...output.matchAll(/BREAKEVEN\|[^\r\n]+/g)].map((match) => match[0].trim());
if (lines.length !== 8) throw new Error(`expected 8 BREAKEVEN records, found ${lines.length}`);

const parseValue = (value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
};

const rawRows = lines.map((line) =>
  Object.fromEntries(
    line
      .split("|")
      .slice(1)
      .map((field) => {
        const separator = field.indexOf("=");
        return [field.slice(0, separator), parseValue(field.slice(separator + 1))];
      }),
  ),
);

const ETH_PRICE_SCENARIOS_USD = [2_000, 3_000, 4_000];
const GAS_PRICE_SCENARIOS_GWEI = [0.01, 0.1, 1];
const RAW_UNIT = 1e6;

const rows = rawRows
  .map((raw) => {
    const comparable = raw.nettingSucceeded && raw.vanillaFullFill;
    const outputAdvantage = comparable ? raw.nettingOutput - raw.bestVanillaOutput : null;
    const gasPremium = comparable ? raw.nettingTotalGas - raw.bestVanillaTotalGas : null;
    return {
      mode: raw.mode,
      anchorNotionalTokens: raw.notional / RAW_UNIT,
      opposingNotionalTokens: raw.opposing / RAW_UNIT,
      submittedGrossTokens: raw.gross / RAW_UNIT,
      liquidity: raw.liquidity,
      matchedGrossTokens: raw.matchedGross / RAW_UNIT,
      residualTokens: raw.residual / RAW_UNIT,
      nettingSucceeded: raw.nettingSucceeded,
      vanillaFullFill: raw.vanillaFullFill,
      comparable,
      nettingOutputTokens: raw.nettingOutput / RAW_UNIT,
      bestVanillaOutputTokens: comparable ? raw.bestVanillaOutput / RAW_UNIT : null,
      outputAdvantageTokens: comparable ? outputAdvantage / RAW_UNIT : null,
      outputAdvantageBpsOfGross: comparable
        ? Math.round((outputAdvantage * 1e8) / raw.gross) / 1e4
        : null,
      nettingTotalGas: raw.nettingTotalGas,
      bestVanillaTotalGas: comparable ? raw.bestVanillaTotalGas : null,
      gasPremium,
      breakEvenGasPriceGweiAtEth3000: comparable
        ? Math.round(((outputAdvantage / RAW_UNIT) * 1e13) / (gasPremium * 3_000)) / 1e4
        : null,
      endingTicks: {
        netting: raw.nettingTick,
        vanillaZeroForOneFirst: raw.zeroFirstTick,
        vanillaOneForZeroFirst: raw.oneFirstTick,
      },
      vanillaActualInputs: {
        zeroForOneFirst: {
          token0: raw.zeroFirstInput0 / RAW_UNIT,
          token1: raw.zeroFirstInput1 / RAW_UNIT,
          executionSucceeded: raw.zeroFirstSucceeded,
        },
        oneForZeroFirst: {
          token0: raw.oneFirstInput0 / RAW_UNIT,
          token1: raw.oneFirstInput1 / RAW_UNIT,
          executionSucceeded: raw.oneFirstSucceeded,
        },
      },
    };
  })
  .sort((a, b) => a.mode.localeCompare(b.mode) || a.anchorNotionalTokens - b.anchorNotionalTokens);

const scaledRows = rows.filter((row) => row.mode === "scaled" && row.comparable);
const savingsUsdPerAnchorDollar =
  scaledRows.reduce((sum, row) => sum + row.anchorNotionalTokens * row.outputAdvantageTokens, 0)
  / scaledRows.reduce((sum, row) => sum + row.anchorNotionalTokens ** 2, 0);
const conservativeGasPremium = Math.max(...scaledRows.map((row) => row.gasPremium));

const sensitivity = ETH_PRICE_SCENARIOS_USD.flatMap((ethPriceUsd) =>
  GAS_PRICE_SCENARIOS_GWEI.map((gasPriceGwei) => {
    const gasPremiumUsd = conservativeGasPremium * gasPriceGwei * 1e-9 * ethPriceUsd;
    return {
      ethPriceUsd,
      gasPriceGwei,
      gasPremiumUsd,
      breakEvenAnchorNotionalUsd: gasPremiumUsd / savingsUsdPerAnchorDollar,
      breakEvenGrossNotionalUsd: (gasPremiumUsd / savingsUsdPerAnchorDollar) * 1.7,
    };
  }),
);

const profitabilityAtEth3000 = scaledRows.map((row) => ({
  anchorNotionalUsd: row.anchorNotionalTokens,
  grossNotionalUsd: row.submittedGrossTokens,
  outputBenefitUsd: row.outputAdvantageTokens,
  scenarios: GAS_PRICE_SCENARIOS_GWEI.map((gasPriceGwei) => {
    const gasPremiumUsd = conservativeGasPremium * gasPriceGwei * 1e-9 * 3_000;
    return {
      gasPriceGwei,
      gasPremiumUsd,
      netBenefitUsd: row.outputAdvantageTokens - gasPremiumUsd,
      economicallyPositive: row.outputAdvantageTokens >= gasPremiumUsd,
    };
  }),
}));

const result = {
  schemaVersion: 1,
  benchmark: "ILAL gas-cost break-even by notional",
  conclusionModel: {
    matchingPattern: "anchor token0 order N; opposing token1 order 0.7N; gross notional 1.7N",
    savingsUsdPerAnchorDollar,
    savingsBpsOfAnchorNotional: savingsUsdPerAnchorDollar * 10_000,
    conservativeGasPremium,
    gasPremiumRule: "maximum measured total-gas premium across comparable scaled-liquidity rows",
    totalGasDefinition:
      "measured execution gas plus calldata gas and 21,000 intrinsic gas for one ILAL transaction versus two independent vanilla transactions",
  },
  assumptions: {
    tokenDecimals: 6,
    stablecoinValueUsd: 1,
    rawUnitInternalMatch: "1:1",
    poolFeePips: 500,
    liquidityRange: [-1000, 1000],
    fixedLiquidity: 1_000_000_000_000,
    scaledLiquidityRule: "1,000,000,000,000 liquidity per 100 anchor tokens",
    ethPriceScenariosUsd: ETH_PRICE_SCENARIOS_USD,
    gasPriceScenariosGwei: GAS_PRICE_SCENARIOS_GWEI,
  },
  limitations: [
    "Gas and ETH/USD values are scenario inputs, not claims about current Base or ETH market conditions.",
    "Vanilla uses the Foundry direct v4 test router with pre-existing approvals; it is not a Universal Router or Permit2 production trace.",
    "The total-gas model adds exact encoded calldata and transaction intrinsic gas but does not include L1 data fees, solver discovery, latency, MEV, or off-chain operating cost.",
    "The equal-decimal mock stablecoins are valued at raw-unit 1:1 and $1 each; this is not an oracle-priced market claim.",
    "Fixed-liquidity 100k/70k is capacity-limited and is excluded from economic interpolation.",
  ],
  sensitivity,
  profitabilityAtEth3000,
  rows,
};

const jsonPath = resolve(root, "docs/hookathon/break-even-results.json");
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

const money = (value, digits = 2) =>
  `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
const integer = (value) => Math.round(value).toLocaleString("en-US");
const signedMoney = (value) => `${value >= 0 ? "+" : "−"}$${Math.abs(value).toFixed(3)}`;

const scaledTable = scaledRows
  .map(
    (row) =>
      `| ${integer(row.anchorNotionalTokens)} | ${integer(row.submittedGrossTokens)} | ${money(row.outputAdvantageTokens, 6)} | ${row.outputAdvantageBpsOfGross.toFixed(2)} bps | ${integer(row.gasPremium)} | ${row.breakEvenGasPriceGweiAtEth3000.toFixed(3)} gwei |`,
  )
  .join("\n");

const fixedTable = rows
  .filter((row) => row.mode === "fixed")
  .map((row) => {
    if (!row.comparable) {
      return `| ${integer(row.anchorNotionalTokens)} | capacity-limited | capacity-limited | ${row.nettingSucceeded ? "yes" : "no"} | ${row.vanillaFullFill ? "yes" : "no"} | n/a |`;
    }
    return `| ${integer(row.anchorNotionalTokens)} | ${row.outputAdvantageTokens.toFixed(6)} | ${row.outputAdvantageBpsOfGross.toFixed(2)} bps | yes | yes | ${row.endingTicks.netting} |`;
  })
  .join("\n");

const sensitivityTable = ETH_PRICE_SCENARIOS_USD.map((ethPrice) => {
  const cells = GAS_PRICE_SCENARIOS_GWEI.map((gasPrice) => {
    const scenario = sensitivity.find(
      (candidate) => candidate.ethPriceUsd === ethPrice && candidate.gasPriceGwei === gasPrice,
    );
    return money(scenario.breakEvenAnchorNotionalUsd, 2);
  });
  return `| ${money(ethPrice, 0)} | ${cells.join(" | ")} |`;
}).join("\n");

const profitabilityTable = profitabilityAtEth3000
  .map(
    (row) =>
      `| ${integer(row.anchorNotionalUsd)} | ${money(row.outputBenefitUsd, 6)} | ${row.scenarios.map((scenario) => signedMoney(scenario.netBenefitUsd)).join(" | ")} |`,
  )
  .join("\n");

const eth3000BreakEvens = GAS_PRICE_SCENARIOS_GWEI.map((gasPrice) =>
  sensitivity.find((scenario) => scenario.ethPriceUsd === 3_000 && scenario.gasPriceGwei === gasPrice),
);

const markdown = `# Gas-cost break-even benchmark

This benchmark answers a narrower economic question than the mechanism test:
**at what order notional does ILAL's execution improvement exceed its gas
premium?** It fixes the opposing-flow pattern at \`N / 0.7N\` and tests anchor
notionals of 100, 1,000, 10,000 and 100,000 tokens.

Run it from the repository root:

\`\`\`bash
make break-even-benchmark
\`\`\`

## Headline result

With liquidity scaled proportionally to notional, the measured user benefit is
approximately **${(savingsUsdPerAnchorDollar * 10_000).toFixed(2)} bps of anchor notional**
(${(savingsUsdPerAnchorDollar * 10_000 / 1.7).toFixed(2)} bps of gross submitted notional).
The conservative measured total-gas premium is **${integer(conservativeGasPremium)} gas**.

At a scenario ETH price of $3,000, the resulting anchor-notional break-even is:

- **${money(eth3000BreakEvens[0].breakEvenAnchorNotionalUsd, 2)}** at 0.01 gwei
- **${money(eth3000BreakEvens[1].breakEvenAnchorNotionalUsd, 2)}** at 0.1 gwei
- **${money(eth3000BreakEvens[2].breakEvenAnchorNotionalUsd, 2)}** at 1 gwei

These are sensitivity inputs, not claims about current ETH or Base gas prices.

## Scaled-liquidity notional sweep

| Anchor notional | Gross notional | User output benefit | Benefit vs gross | Total-gas premium | Break-even gas price at $3k ETH |
|---:|---:|---:|---:|---:|---:|
${scaledTable}

Scaling liquidity keeps price depth constant and isolates gas amortization. The
gas premium stays approximately fixed while user benefit grows linearly with
notional.

## Break-even anchor notional sensitivity

| ETH/USD scenario | 0.01 gwei | 0.1 gwei | 1 gwei |
|---:|---:|---:|---:|
${sensitivityTable}

## Net benefit at $3,000 ETH

| Anchor notional | Execution benefit | 0.01 gwei | 0.1 gwei | 1 gwei |
|---:|---:|---:|---:|---:|
${profitabilityTable}

Positive values mean the measured output improvement exceeds the conservative
gas premium. Negative values mean gas costs more than the measured execution
benefit under that scenario.

## Fixed candidate-liquidity stress test

| Anchor notional | Output advantage | Benefit vs gross | ILAL full execution | Vanilla full fill | ILAL ending tick |
|---:|---:|---:|---:|---:|---:|
${fixedTable}

The fixed-liquidity \`100k/70k\` row is deliberately reported as
**capacity-limited**, not as an economic win. With the candidate's
1,000,000,000,000 liquidity and [-1000, 1000] LP range, the ILAL batch reverts
during immediate settlement and neither vanilla ordering fully consumes both
signed inputs. It is excluded from break-even interpolation.

This exposes an operational boundary: a solver must preflight both price depth
and physical PoolManager token balances. Large batches need deeper liquidity,
smaller residuals, stricter signed limits, or a settlement design that does not
attempt an output transfer before the offsetting input has arrived.

## Gas methodology and limits

- ILAL total gas is measured execution gas plus encoded calldata gas and one
  21,000-gas transaction envelope.
- Vanilla total gas is the lower-gas full-fill ordering plus encoded calldata
  gas and two 21,000-gas transaction envelopes.
- The sensitivity model uses the maximum measured scaled-liquidity gas premium,
  avoiding a lower break-even caused by fixture warming or row-level variance.
- Vanilla is the direct Foundry v4 test router with approvals already in place;
  it is not a Universal Router, Permit2 or production bundler trace.
- L1 data fees, solver discovery, latency, MEV, approval setup and off-chain
  operating cost are not included.
- Both mock stablecoins are assumed to be worth $1 and match at raw-unit 1:1.

Machine-readable results: [\`break-even-results.json\`](break-even-results.json).
`;

const markdownPath = resolve(root, "docs/hookathon/BREAK_EVEN.md");
writeFileSync(markdownPath, markdown);
process.stdout.write(`wrote ${jsonPath}\nwrote ${markdownPath}\n`);
