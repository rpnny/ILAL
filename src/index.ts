#!/usr/bin/env node
import { Command } from "commander";
import { credentialStatus } from "./commands/credential.js";
import { credentialProve } from "./commands/prove.js";
import { oracleProposeRoot, oracleActivateRoot, oracleProposeVerifier, oracleActivateVerifier } from "./commands/oracle.js";
import { mintCredential, renewCredential } from "./commands/mint.js";
import { proofMint, proofRenew } from "./commands/proof.js";
import { sessionSign } from "./commands/session.js";
import { poolPolicySet, poolPolicyGet } from "./commands/pool.js";
import { deploy } from "./commands/deploy.js";
import { demo, demoCheck, demoFaucet } from "./commands/demo.js";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { swap } from "./commands/swap.js";
import { addLiquidity, removeLiquidity } from "./commands/liquidity.js";
import { fmt } from "./ui.js";
import { COINBASE_SCHEMA_UID } from "./constants.js";

const program = new Command();

program
  .name("ilal")
  .description("ILAL Protocol CLI — Uniswap v4 compliance hook toolkit")
  .version("0.2.3")
  .addHelpText("before", `\n  ${fmt.bold(fmt.cyan("◆"))} ${fmt.bold("ILAL Protocol")}  ${fmt.gray("Uniswap v4 Compliance Hook")}\n`);

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Create .ilal.json config — save issuer, chain, hook addresses")
  .option("-i, --issuer <address>",   "CNFIssuer contract address")
  .option("-H, --hook <address>",     "ComplianceHook contract address")
  .option("-R, --registry <address>", "PolicyRegistry contract address")
  .option("--router <address>",       "ILALRouter contract address")
  .option("--treasury <address>",     "ILAL protocol fee treasury address")
  .option("--token-a <address>",      "Demo token A / currency0 address")
  .option("--token-b <address>",      "Demo token B / currency1 address")
  .option("--pool-id <bytes32>",      "Default Uniswap v4 pool ID")
  .option("--fee <uint24>",           "Pool fee tier; 8388608 means dynamic fee")
  .option("--tick-spacing <int24>",   "Pool tick spacing")
  .option("-c, --chain <chainId>",    "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>",          "Custom RPC URL")
  .option("--circuit-dir <path>",     "Path to circuits/build directory")
  .option("-f, --force",              "Overwrite existing .ilal.json", false)
  .action(async (opts: { issuer?: string; hook?: string; registry?: string; router?: string; treasury?: string; tokenA?: string; tokenB?: string; poolId?: string; fee?: string; tickSpacing?: string; chain: string; rpc?: string; circuitDir?: string; force: boolean }) => {
    await init(opts).catch(err);
  });

// ─── status ───────────────────────────────────────────────────────────────────

program
  .command("status")
  .description("Dashboard: credential validity, issuer config, pool policy")
  .option("-w, --wallet <address>",   "Wallet address to check")
  .option("-i, --issuer <address>",   "CNFIssuer contract address")
  .option("-H, --hook <address>",     "ComplianceHook contract address")
  .option("-R, --registry <address>", "PolicyRegistry contract address")
  .option("-p, --pool <bytes32>",     "Pool ID to check policy for")
  .option("-c, --chain <chainId>",    "Chain ID", "84532")
  .option("-r, --rpc <url>",          "Custom RPC URL")
  .action(async (opts: { wallet?: string; issuer?: string; hook?: string; registry?: string; pool?: string; chain?: string; rpc?: string }) => {
    await status(opts).catch(err);
  });

// ─── demo ─────────────────────────────────────────────────────────────────────

const demoCommand = program
  .command("demo")
  .description("Preview and preflight the ILAL institutional DeFi demo")
  .option("--commands", "Show the live command sequence after the preview", false)
  .action(async (opts: { commands: boolean }) => {
    await demo(opts).catch(err);
  });

demoCommand
  .command("check")
  .description("Check whether the configured live demo can run on-chain")
  .option("-w, --wallet <address>", "Wallet address to check (defaults to PRIVATE_KEY address)")
  .option("-k, --private-key <hex>", "Private key used only to derive the wallet address")
  .action(async (opts: { wallet?: string; privateKey?: string }) => {
    await demoCheck(opts).catch(err);
  });

demoCommand
  .command("faucet")
  .description("Mint mock demo TOKA/TOKB to a wallet (testnet mock tokens only)")
  .option("-w, --wallet <address>", "Recipient wallet (defaults to PRIVATE_KEY address)")
  .option("--amount <tokens>", "Human token amount to mint for each token", "10000")
  .option("-k, --private-key <hex>", "Private key that pays gas")
  .action(async (opts: { wallet?: string; amount?: string; privateKey?: string }) => {
    await demoFaucet(opts).catch(err);
  });

const err = (e: unknown) => {
  console.error(fmt.red(`\nError: ${e instanceof Error ? e.message : String(e)}\n`));
  process.exit(1);
};

// ─── credential ───────────────────────────────────────────────────────────────

const credential = program.command("credential").description("Manage compliance credentials (CNF)");

credential
  .command("status <wallet>")
  .description("Check CNF credential status for a wallet")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (wallet: string, opts: { issuer: string; chain: string; rpc?: string }) => {
    await credentialStatus({ wallet, ...opts }).catch(err);
  });

credential
  .command("prove")
  .description("Generate ZK proof and mint/renew CNF in one step (no shell scripts needed)")
  .option("-w, --wallet <address>", "Wallet address to prove eligibility for")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-a, --action <action>", "mint or renew (default: auto-detect)")
  .option("--circuit-dir <path>", "Path to circuits/build directory (auto-detected by default)")
  .option("--out-dir <path>", "Directory to write proof/witness files")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { wallet: string; issuer: string; action?: string; circuitDir?: string; outDir?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await credentialProve(opts).catch(err);
  });

credential
  .command("mint")
  .description("Mint a CNF credential using a Coinbase EAS attestation")
  .requiredOption("-a, --attestation <uid>", "EAS attestation UID (0x + 64 hex chars)")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .option("--simulate", "Verify attestation without sending tx", false)
  .action(async (opts: { attestation: string; issuer: string; chain: string; rpc?: string; privateKey?: string; simulate: boolean }) => {
    await mintCredential(opts).catch(err);
  });

credential
  .command("renew")
  .description("Renew an existing CNF credential with a fresh EAS attestation")
  .requiredOption("-a, --attestation <uid>", "EAS attestation UID (0x + 64 hex chars)")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .option("--simulate", "Verify attestation without sending tx", false)
  .action(async (opts: { attestation: string; issuer: string; chain: string; rpc?: string; privateKey?: string; simulate: boolean }) => {
    await renewCredential(opts).catch(err);
  });

// ─── proof ────────────────────────────────────────────────────────────────────

const proof = program.command("proof").description("ZK proof credential operations (Phase 4)");

proof
  .command("mint")
  .description("Mint a CNF using a Groth16 ZK proof (snarkjs format)")
  .requiredOption("-p, --proof <path>", "Path to snarkjs proof.json")
  .requiredOption("-P, --public <path>", "Path to snarkjs public.json")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { proof: string; public: string; issuer: string; chain: string; rpc?: string; privateKey?: string }) => {
    await proofMint(opts).catch(err);
  });

proof
  .command("renew")
  .description("Renew a CNF using a Groth16 ZK proof (snarkjs format)")
  .requiredOption("-p, --proof <path>", "Path to snarkjs proof.json")
  .requiredOption("-P, --public <path>", "Path to snarkjs public.json")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { proof: string; public: string; issuer: string; chain: string; rpc?: string; privateKey?: string }) => {
    await proofRenew(opts).catch(err);
  });

// ─── session ──────────────────────────────────────────────────────────────────

const session = program.command("session").description("Session token operations");

session
  .command("sign")
  .description("Sign an EIP-712 session token locally — no ILAL API call")
  .requiredOption("-p, --pool <bytes32>", "Pool ID (bytes32 hex)")
  .requiredOption("-a, --action <action>", "Action: swap | addLiquidity | removeLiquidity")
  .requiredOption("-H, --hook <address>", "ComplianceHook contract address")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .option("-u, --user <address>", "Trader address (defaults to key's address)")
  .option("--caller <address>", "Authorized v4 caller (defaults to user; use ILALRouter address for router flows)")
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-t, --ttl <seconds>", "Session lifetime in seconds", "600")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { pool: string; action: string; hook: string; issuer: string; user?: string; caller?: string; chain: string; ttl: string; privateKey?: string }) => {
    await sessionSign({ ...opts, ttl: parseInt(opts.ttl, 10) }).catch(err);
  });

// ─── pool ─────────────────────────────────────────────────────────────────────

const pool = program.command("pool").description("Pool operator commands");

const policy = pool.command("policy").description("Pool compliance policy commands");

policy
  .command("set")
  .description("Register a compliance policy for a pool (pool operator only)")
  .requiredOption("-p, --pool <bytes32>", "Pool ID (bytes32 hex)")
  .requiredOption("-i, --issuer <address>", "CNFIssuer contract address")
  .requiredOption("-R, --registry <address>", "PolicyRegistry contract address")
  .option("-T, --cred-type <bytes32>", "Required credential type", COINBASE_SCHEMA_UID)
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { pool: string; issuer: string; registry: string; credType: string; chain: string; rpc?: string; privateKey?: string }) => {
    await poolPolicySet(opts).catch(err);
  });

policy
  .command("get")
  .description("Read the compliance policy for a pool")
  .requiredOption("-p, --pool <bytes32>", "Pool ID (bytes32 hex)")
  .requiredOption("-R, --registry <address>", "PolicyRegistry contract address")
  .option("-c, --chain <chainId>", "Chain ID", "8453")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { pool: string; registry: string; chain: string; rpc?: string }) => {
    await poolPolicyGet(opts).catch(err);
  });

pool
  .command("add-liquidity")
  .description("Add liquidity to a compliant Uniswap v4 pool through the ILAL channel")
  .requiredOption("--tick-lower <int24>", "Lower tick of position")
  .requiredOption("--tick-upper <int24>", "Upper tick of position")
  .requiredOption("--liquidity <uint128>", "Liquidity amount to add (in raw units)")
  .option("--salt <bytes32>", "Position salt for multiple positions at the same range", "0x0000000000000000000000000000000000000000000000000000000000000000")
  .option("--pool-id <bytes32>", "Pool ID (or set in .ilal.json)")
  .option("--router <address>", "ILALRouter address (or set in .ilal.json)")
  .option("-H, --hook <address>", "ComplianceHook address (or set in .ilal.json)")
  .option("-i, --issuer <address>", "CNFIssuer address (or set in .ilal.json)")
  .option("--token-a <address>", "currency0 token address (or set in .ilal.json)")
  .option("--token-b <address>", "currency1 token address (or set in .ilal.json)")
  .option("--fee <uint24>", "Pool fee tier (default: config or 3000; 8388608=dynamic)")
  .option("--tick-spacing <int24>", "Tick spacing (default: config or 60)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .option("--ttl <seconds>", "Session token lifetime in seconds", "600")
  .action(async (opts: {
    tickLower: string; tickUpper: string; liquidity: string; salt?: string;
    poolId?: string; router?: string; hook?: string; issuer?: string;
    tokenA?: string; tokenB?: string; fee?: string; tickSpacing?: string;
    chain: string; rpc?: string; privateKey?: string; ttl: string;
  }) => {
    await addLiquidity(opts).catch(err);
  });

pool
  .command("remove-liquidity")
  .description("Remove liquidity from a compliant Uniswap v4 pool through the ILAL channel")
  .requiredOption("--tick-lower <int24>", "Lower tick of position")
  .requiredOption("--tick-upper <int24>", "Upper tick of position")
  .requiredOption("--liquidity <uint128>", "Liquidity amount to remove (in raw units)")
  .option("--salt <bytes32>", "Position salt", "0x0000000000000000000000000000000000000000000000000000000000000000")
  .option("--pool-id <bytes32>", "Pool ID (or set in .ilal.json)")
  .option("--router <address>", "ILALRouter address (or set in .ilal.json)")
  .option("-H, --hook <address>", "ComplianceHook address (or set in .ilal.json)")
  .option("-i, --issuer <address>", "CNFIssuer address (or set in .ilal.json)")
  .option("--token-a <address>", "currency0 token address (or set in .ilal.json)")
  .option("--token-b <address>", "currency1 token address (or set in .ilal.json)")
  .option("--fee <uint24>", "Pool fee tier (default: config or 3000; 8388608=dynamic)")
  .option("--tick-spacing <int24>", "Tick spacing (default: config or 60)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .option("--ttl <seconds>", "Session token lifetime in seconds", "600")
  .action(async (opts: {
    tickLower: string; tickUpper: string; liquidity: string; salt?: string;
    poolId?: string; router?: string; hook?: string; issuer?: string;
    tokenA?: string; tokenB?: string; fee?: string; tickSpacing?: string;
    chain: string; rpc?: string; privateKey?: string; ttl: string;
  }) => {
    await removeLiquidity(opts).catch(err);
  });

// ─── swap ─────────────────────────────────────────────────────────────────────

program
  .command("swap")
  .description("Execute a compliant token swap through the ILAL channel")
  .requiredOption("--amount-in <amount>", "Input amount in human-readable units (e.g. 100)")
  .option("--min-amount-out <wei>", "Minimum output amount in wei — reverts if pool gives less (default: 0 = off)")
  .option("--token-in <address>", "Token to sell (defaults to tokenA from config)")
  .option("--token-a <address>", "currency0 token address (or set in .ilal.json)")
  .option("--token-b <address>", "currency1 token address (or set in .ilal.json)")
  .option("--pool-id <bytes32>", "Pool ID (or set in .ilal.json)")
  .option("--router <address>", "ILALRouter address (or set in .ilal.json)")
  .option("-H, --hook <address>", "ComplianceHook address (or set in .ilal.json)")
  .option("-i, --issuer <address>", "CNFIssuer address (or set in .ilal.json)")
  .option("--fee <uint24>", "Pool fee tier (default: config or 3000; 8388608=dynamic)")
  .option("--tick-spacing <int24>", "Tick spacing (default: config or 60)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .option("--ttl <seconds>", "Session token lifetime in seconds", "600")
  .option("--simulate", "Sign session without sending tx", false)
  .action(async (opts: {
    amountIn: string; minAmountOut?: string; tokenIn?: string; tokenA?: string; tokenB?: string;
    poolId?: string; router?: string; hook?: string; issuer?: string;
    fee?: string; tickSpacing?: string; chain: string; rpc?: string;
    privateKey?: string; ttl: string; simulate: boolean;
  }) => {
    await swap(opts).catch(err);
  });

// ─── oracle ───────────────────────────────────────────────────────────────────
// Operator-only commands — require owner key.
// Merkle root and ZK verifier changes are timelocked:
//   ROOT_DELAY = 48h, VERIFIER_DELAY = 72h.

const oracle = program
  .command("oracle")
  .description("Operator commands for managing timelocked Merkle root and ZK verifier");

oracle
  .command("propose-root")
  .description("Queue a new Merkle root (step 1 of 2 — owner only, ROOT_DELAY = 48 h timelock)")
  .requiredOption("--root <uint256>", "New Merkle root value (decimal or 0x hex)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { root: string; issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleProposeRoot(opts).catch(err);
  });

oracle
  .command("activate-root")
  .description("Activate the pending Merkle root after the 48-hour timelock has elapsed (step 2 of 2)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleActivateRoot(opts).catch(err);
  });

oracle
  .command("propose-verifier")
  .description("Queue a new ZK verifier contract (step 1 of 2 — owner only, VERIFIER_DELAY = 72 h)")
  .requiredOption("--verifier <address>", "New IGroth16Verifier contract address")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { verifier: string; issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleProposeVerifier(opts).catch(err);
  });

oracle
  .command("activate-verifier")
  .description("Activate the pending ZK verifier after the 72-hour timelock has elapsed (step 2 of 2)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .action(async (opts: { issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleActivateVerifier(opts).catch(err);
  });

// ─── deploy ───────────────────────────────────────────────────────────────────

program
  .command("deploy")
  .description("Deploy ILAL contracts (PolicyRegistry + CNFIssuer + ComplianceHook)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("-k, --private-key <hex>", "Private key (or set PRIVATE_KEY env var)")
  .option("--broadcast", "Send transactions (omit for dry run)", false)
  .option("--verify", "Verify contracts on Etherscan/Basescan", false)
  .option("--mock", "Use MockEAS for testnet (Base Sepolia only)", false)
  .option("--wallet-to-seed <address>", "Wallet that receives a seeded test attestation (--mock only)")
  .option("--contracts-dir <path>", "Path to contracts/ directory")
  .action(async (opts: { chain: string; rpc?: string; privateKey?: string; broadcast: boolean; verify: boolean; mock: boolean; walletToSeed?: string; contractsDir?: string }) => {
    await deploy(opts).catch(err);
  });

program.parse();
