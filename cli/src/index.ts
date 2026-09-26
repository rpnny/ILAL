#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { registerMixed, mixedContext } from './commands/mixed.js';
import { configureSignerOptions, type GlobalSignerOptions } from './signer.js';
import { safePropose } from './safe.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const program = new Command();
program.name('ilal').description('ILAL — eligibility, atomic execution and owner-controlled liquidity').version(version)
  .option('--keystore <path>', 'Encrypted Web3 Secret Storage v3 keystore')
  .option('--password-file <path>', 'Keystore password file (mode 600)')
  .option('--rpc-account <address>', 'Account managed by the configured JSON-RPC node')
  .option('--unsafe-private-key', 'Allow testnet-only PRIVATE_KEY compatibility mode', false)
  .option('--safe <address>', 'Safe account for a governance proposal')
  .option('--safe-tx-service <url>', 'Safe Transaction Service URL')
  .option('--owner-keystore <path>', 'Safe owner keystore')
  .option('--owner-password-file <path>', 'Safe owner password file (mode 600)')
  .option('--safe-output <path>', 'Write a reviewable Safe proposal JSON file')
  .option('--submit-safe-proposal', 'Submit the signed proposal to Safe Transaction Service', false);
program.hook('preAction', () => configureSignerOptions(program.opts() as GlobalSignerOptions));
registerMixed(program);
program.command('safe-propose').description('Prepare a Safe governance proposal from reviewed calldata')
  .requiredOption('--manifest <path>', 'ILAL deployment manifest')
  .requiredOption('--rpc <url>', 'Explicit RPC URL')
  .requiredOption('--to <address>', 'Reviewed target address')
  .requiredOption('--data <hex>', 'Reviewed calldata')
  .option('--value <wei>', 'Native value', '0')
  .action(async opts => {
    const { chain } = mixedContext(opts.manifest, opts.rpc);
    await safePropose({ ...opts, chain });
  });
program.parseAsync().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
