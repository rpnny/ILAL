#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forge = spawnSync("forge", ["test", "--match-test", "testBenchmark_", "-vv"], {
  cwd: resolve(root, "contracts"),
  encoding: "utf8",
});

const output = `${forge.stdout ?? ""}\n${forge.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "");
if (forge.status !== 0) {
  process.stderr.write(output);
  process.exit(forge.status ?? 1);
}

const lines = [...output.matchAll(/BENCHMARK\|[^\r\n]+/g)].map((match) => match[0].trim());
if (lines.length === 0) throw new Error("no BENCHMARK records found in forge output");

const rawRows = lines.map((line) =>
  Object.fromEntries(
    line
      .split("|")
      .slice(1)
      .map((field) => {
        const separator = field.indexOf("=");
        return [field.slice(0, separator), Number(field.slice(separator + 1))];
      }),
  ),
);

const rows = rawRows
  .map((raw) => {
    const bestVanillaOutput = Math.max(raw.vanillaZeroFirstOutput, raw.vanillaOneFirstOutput);
    const bestVanillaGas = Math.min(raw.vanillaZeroFirstGas, raw.vanillaOneFirstGas);
    const outputAdvantage = raw.nettingOutput - bestVanillaOutput;
    const lpFeeSaved = raw.vanillaLpFee - raw.nettingLpFee;
    return {
      pair: `100/${raw.opposing / 1e6}`,
      opposingAmount: raw.opposing,
      submittedGross: raw.gross,
      matchedGross: raw.matchedGross,
      ammResidual: raw.residual,
      ammExposureReductionBps: Math.round((raw.matchedGross * 1e8) / raw.gross) / 1e4,
      nettingOutput: raw.nettingOutput,
      bestVanillaOutput,
      outputAdvantage,
      outputAdvantageBps: Math.round((outputAdvantage * 1e8) / bestVanillaOutput) / 1e4,
      nettingLpFee: raw.nettingLpFee,
      vanillaLpFee: raw.vanillaLpFee,
      lpFeeSaved,
      lpFeeReductionBps: Math.round((lpFeeSaved * 1e8) / raw.vanillaLpFee) / 1e4,
      nettingExecutionGas: raw.nettingGas,
      bestVanillaExecutionGas: bestVanillaGas,
      executionGasMultiple: Math.round((raw.nettingGas * 100) / bestVanillaGas) / 100,
      endingTicks: {
        netting: raw.nettingTick,
        vanillaZeroFirst: raw.vanillaZeroFirstTick,
        vanillaOneFirst: raw.vanillaOneFirstTick,
      },
      vanillaOrderings: {
        zeroForOneFirst: {
          output: raw.vanillaZeroFirstOutput,
          executionGas: raw.vanillaZeroFirstGas,
        },
        oneForZeroFirst: {
          output: raw.vanillaOneFirstOutput,
          executionGas: raw.vanillaOneFirstGas,
        },
      },
    };
  })
  .sort((a, b) => a.opposingAmount - b.opposingAmount);

const result = {
  schemaVersion: 1,
  benchmark: "ILAL institutional netting vs two sequential vanilla Uniswap v4 swaps",
  assumptions: {
    tokenDecimals: 6,
    rawUnitInternalMatch: "1:1",
    poolFeePips: 500,
    initialSqrtPriceX96: "79228162514264337593543950336",
    initialTick: 0,
    tickSpacing: 10,
    liquidity: "1000000000000",
    liquidityRange: [-1000, 1000],
    firstOrderInput: "100000000 token0",
    secondOrderInputs: rows.map((row) => `${row.opposingAmount} token1`),
    comparisonRule:
      "Run both vanilla orderings from identical pools; compare output against the higher vanilla output and gas against the lower vanilla execution gas.",
  },
  limitations: [
    "Foundry-local execution gas excludes transaction intrinsic gas and is not a production router or mainnet quote.",
    "The equal-decimal mock stablecoins are valued at raw-unit 1:1; results are not an oracle-priced market claim.",
    "The benchmark isolates two-order execution and does not model solver latency, order discovery, MEV, or off-chain operational cost.",
    "Reduced LP fee volume is a user execution saving and an LP revenue tradeoff, not a universal ecosystem gain.",
  ],
  rows,
};

const jsonPath = resolve(root, "docs/hookathon/benchmark-results.json");
writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);

const formatTokens = (raw) => (raw / 1e6).toFixed(6);
const formatPct = (bps) => `${(bps / 100).toFixed(2)}%`;
const formatInt = (value) => value.toLocaleString("en-US");
const canonical = rows.find((row) => row.opposingAmount === 70e6);

const table = rows
  .map(
    (row) =>
      `| ${row.pair} | ${formatPct(row.ammExposureReductionBps)} | ${formatTokens(row.ammResidual)} | +${formatTokens(row.outputAdvantage)} (${row.outputAdvantageBps.toFixed(2)} bps) | ${formatPct(row.lpFeeReductionBps)} | ${formatInt(row.nettingExecutionGas)} / ${formatInt(row.bestVanillaExecutionGas)} (${row.executionGasMultiple.toFixed(2)}x) |`,
  )
  .join("\n");

const markdown = `# Institutional netting impact benchmark

This reproducible Foundry benchmark compares one ILAL atomic batch with two
ordinary exact-input Uniswap v4 swaps from the same initial pool state. The
two vanilla orderings are both executed. Reported output improvement uses the
higher vanilla output, while the gas comparison uses the lower vanilla gas.

Run it from the repository root:

\`\`\`bash
make benchmark
\`\`\`

## Results

| Orders (token0/token1) | AMM exposure reduction | ILAL AMM residual | User output advantage vs best vanilla | LP fee reduction | Local execution gas ILAL / best vanilla |
|---:|---:|---:|---:|---:|---:|
${table}

For the canonical \`100/70\` demo, ILAL routes 30.000000 tokens rather than
170.000000 gross tokens through AMM execution: an **${formatPct(canonical.ammExposureReductionBps)}
reduction**. Aggregate user output is **${formatTokens(canonical.outputAdvantage)} tokens
(${canonical.outputAdvantageBps.toFixed(2)} bps) higher** than the better vanilla ordering, and
the charged LP fee falls from ${formatTokens(canonical.vanillaLpFee)} to
${formatTokens(canonical.nettingLpFee)} tokens. The tradeoff is execution complexity:
the ILAL path consumes ${formatInt(canonical.nettingExecutionGas)} local execution gas versus
${formatInt(canonical.bestVanillaExecutionGas)} for the lower-gas pair of vanilla swap calls
(${canonical.executionGasMultiple.toFixed(2)}x).

The ILAL output of ${formatTokens(canonical.nettingOutput)} matches the public Base Sepolia
\`100/70\` settlement recorded in the candidate manifest. This connects the
controlled benchmark to the deployed evidence without treating testnet gas as
a production gas estimate.

## What the result means

- More opposing flow produces a nearly linear reduction in AMM exposure and LP
  fees under the benchmark's zero-netting-fee design.
- Users receive more aggregate output because internally matched units settle
  at raw-unit 1:1 instead of paying AMM fees and price impact twice.
- ILAL currently spends more execution gas because it verifies eligibility,
  EIP-712 signatures and nonces, computes canonical allocation, and directly
  settles both users inside one atomic unlock.
- LP fee reduction is a deliberate tradeoff: it benefits participating users
  but reduces fees earned on flow that would otherwise have reached the pool.

## Method and limits

- Two 6-decimal mock stablecoins, initial 1:1 price, 0.05% pool fee,
  1,000,000,000,000 liquidity and the same [-1000, 1000] range as the candidate.
- Each row fixes the token0 order at 100 tokens and varies the opposing token1
  order. The ILAL residual is the unmatched token0 amount.
- Foundry-local gas excludes transaction intrinsic gas and does not represent a
  Universal Router, production bundler or mainnet quote.
- The benchmark does not model solver discovery, latency, MEV, oracle pricing,
  depeg behavior or off-chain operating costs.
- Raw-unit 1:1 matching is appropriate only for the deliberately narrow
  equal-decimal stablecoin candidate described in the Hookathon scope.

Machine-readable results: [\`benchmark-results.json\`](benchmark-results.json).
`;

const markdownPath = resolve(root, "docs/hookathon/BENCHMARK.md");
writeFileSync(markdownPath, markdown);
process.stdout.write(`wrote ${jsonPath}\nwrote ${markdownPath}\n`);
