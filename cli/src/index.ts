#!/usr/bin/env node
import { Command } from "commander";
import { credentialStatus } from "./commands/credential.js";
import { credentialProve, credentialRoot } from "./commands/prove.js";
import {
  oracleActivateDomain,
  oracleActivateRoot,
  oracleActivateVerifier,
  oracleProposeDomain,
  oracleProposeRoot,
  oracleProposeVerifier,
} from "./commands/oracle.js";
import { mintCredential, renewCredential } from "./commands/mint.js";
import { proofMint, proofRenew } from "./commands/proof.js";
import { sessionSign } from "./commands/session.js";
import { poolPolicySet, poolPolicyGet } from "./commands/pool.js";
import { deploy } from "./commands/deploy.js";
import { demo, demoCheck, demoFaucet, demoAttest } from "./commands/demo.js";
import { init } from "./commands/init.js";
import { status } from "./commands/status.js";
import { swap } from "./commands/swap.js";
import { addLiquidity, removeLiquidity } from "./commands/liquidity.js";
import { issuerAttest, issuerCreate, issuerGet, issuerSetJurisdiction, issuerSetType } from "./commands/issuer.js";
import { policyGrantActivate, policyGrantStatus } from "./commands/policyV2.js";
import { fmt } from "./ui.js";
import { COINBASE_SCHEMA_UID } from "./constants.js";
import { configureSignerOptions, type GlobalSignerOptions } from "./signer.js";
import { safePropose } from "./safe.js";
import { base, baseSepolia } from "viem/chains";

const program = new Command();

program
  .name("ilal")
  .description("ILAL Protocol CLI — Uniswap v4 compliance hook toolkit")
  .version("0.3.3")
  .option("--keystore <path>", "Encrypted Web3 Secret Storage v3 keystore")
  .option("--password-file <path>", "Keystore password file (must be mode 600)")
  .option("--rpc-account <address>", "Account managed by the configured JSON-RPC node")
  .option("--unsafe-private-key", "Allow testnet-only PRIVATE_KEY compatibility mode", false)
  .option("--safe <address>", "Safe account for an administrative transaction proposal")
  .option("--safe-tx-service <url>", "Safe Transaction Service base URL")
  .option("--owner-keystore <path>", "Safe owner keystore used to sign a proposal")
  .option("--owner-password-file <path>", "Safe owner password file (must be mode 600)")
  .option("--safe-output <path>", "Write a reviewable Safe proposal JSON file")
  .option("--submit-safe-proposal", "Submit a signed proposal to Safe Transaction Service", false)
  .addHelpText("before", `\n  ${fmt.bold(fmt.cyan("◆"))} ${fmt.bold("ILAL Protocol")}  ${fmt.gray("Uniswap v4 Compliance Hook")}\n`);

program.hook("preAction", () => {
  configureSignerOptions(program.opts() as GlobalSignerOptions);
});

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command("init")
  .description("Create .ilal.json config — save issuer, chain, hook addresses")
  .option("-i, --issuer <address>",   "CNFIssuer contract address")
  .option("-H, --hook <address>",     "ComplianceHook contract address")
  .option("-R, --registry <address>", "PolicyRegistry contract address")
  .option("--grant-manager <address>", "PolicyGrantManagerV2 contract address")
  .option("--protocol-version <version>", "Protocol version: 1 (CNF) or 2 (policy grant)", "1")
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
  .option("--artifact-url <url>",     "Hosted proving artifact base URL")
  .option("--artifact-cache <path>",  "Local proving artifact cache directory")
  .option("-f, --force",              "Overwrite existing .ilal.json", false)
  .action(async (opts: { protocolVersion: string; issuer?: string; hook?: string; registry?: string; grantManager?: string; router?: string; treasury?: string; tokenA?: string; tokenB?: string; poolId?: string; fee?: string; tickSpacing?: string; chain: string; rpc?: string; circuitDir?: string; artifactUrl?: string; artifactCache?: string; force: boolean }) => {
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
  .option("-w, --wallet <address>", "Wallet address to check (defaults to configured signer)")
  .action(async (opts: { wallet?: string; privateKey?: string }) => {
    await demoCheck(opts).catch(err);
  });

demoCommand
  .command("faucet")
  .description("Mint mock demo TOKA/TOKB to a wallet (testnet mock tokens only)")
  .option("-w, --wallet <address>", "Recipient wallet (defaults to configured signer)")
  .option("--amount <tokens>", "Human token amount to mint for each token", "10000")
  .action(async (opts: { wallet?: string; amount?: string; privateKey?: string }) => {
    await demoFaucet(opts).catch(err);
  });

demoCommand
  .command("attest")
  .description("Legacy testnet alias: create a MockEAS attestation for a wallet")
  .requiredOption("-w, --wallet <address>", "Recipient wallet that will mint the CNF")
  .option("--expires-in-days <days>", "Attestation lifetime in days", "90")
  .action(async (opts: { wallet: string; expiresInDays?: string; privateKey?: string }) => {
    await demoAttest(opts).catch(err);
  });

const err = (e: unknown) => {
  console.error(fmt.red(`\nError: ${e instanceof Error ? e.message : String(e)}\n`));
  process.exit(1);
};

// ─── issuer ──────────────────────────────────────────────────────────────────

const issuer = program.command("issuer").description("Issuer standard management");

issuer
  .command("attest")
  .description("Create an issuer EAS attestation for a wallet")
  .requiredOption("-w, --wallet <address>", "Recipient wallet that will mint the CNF")
  .option("--schema <bytes32>", "EAS schema UID (defaults to CNFIssuer.schemaUID)")
  .option("--eas <address>", "EAS contract address (defaults to CNFIssuer.eas)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("--expires-in-days <days>", "Attestation lifetime in days", "365")
  .option("--data <hex>", "Optional attestation payload bytes", "0x")
  .option("--no-revocable", "Create a non-revocable EAS attestation")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { wallet: string; schema?: string; eas?: string; issuer?: string; expiresInDays?: string; data?: string; revocable?: boolean; chain?: string; rpc?: string; privateKey?: string }) => {
    await issuerAttest(opts).catch(err);
  });

issuer
  .command("create")
  .description("Create an issuer compliance standard profile and return a standard_id")
  .requiredOption("--standard <name>", "Compliance standard name, e.g. Goldfinch Accredited Investor")
  .action(async (opts: { standard: string }) => {
    await issuerCreate(opts).catch(err);
  });

issuer
  .command("set-jurisdiction")
  .description("Set allowed jurisdictions for an issuer standard")
  .option("--id <standard_id>", "Standard id (defaults to latest created standard)")
  .requiredOption("--allow <list>", "Comma-separated jurisdictions, e.g. US,EU,SG")
  .action(async (opts: { id?: string; allow: string }) => {
    await issuerSetJurisdiction(opts).catch(err);
  });

issuer
  .command("set-type")
  .description("Set investor type requirements for an issuer standard")
  .option("--id <standard_id>", "Standard id (defaults to latest created standard)")
  .requiredOption("--accredited-only <bool>", "true or false")
  .action(async (opts: { id?: string; accreditedOnly: string }) => {
    await issuerSetType(opts).catch(err);
  });

issuer
  .command("get")
  .description("Read an issuer standard profile")
  .option("--id <standard_id>", "Standard id (defaults to latest created standard)")
  .action(async (opts: { id?: string }) => {
    await issuerGet(opts).catch(err);
  });

// ─── credential ───────────────────────────────────────────────────────────────

const credential = program.command("credential").description("Manage compliance credentials (CNF)");

credential
  .command("status <wallet>")
  .description("Check CNF credential status for a wallet")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (wallet: string, opts: { issuer?: string; chain?: string; rpc?: string }) => {
    await credentialStatus({ wallet, ...opts }).catch(err);
  });

credential
  .command("prove")
  .description("Generate ZK proof and mint/renew CNF in one step (no shell scripts needed)")
  .option("-w, --wallet <address>", "Wallet address to prove eligibility for")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-a, --action <action>", "mint or renew (default: auto-detect)")
  .option("--circuit-dir <path>", "Path to circuits/build directory (dev/offline override)")
  .option("--artifact-url <url>", "Hosted proving artifact base URL (defaults to ILAL release artifacts)")
  .option("--artifact-cache <path>", "Local proving artifact cache directory (default: ~/.ilal/artifacts/ilal-v1)")
  .option("--offline", "Do not download proving artifacts; require cache or --circuit-dir", false)
  .option("--out-dir <path>", "Directory to write proof/witness files")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--expires-at <unix>", "Unix timestamp used in the ZK proof/root (must match issuer root)")
  .action(async (opts: { wallet: string; issuer: string; action?: string; circuitDir?: string; artifactUrl?: string; artifactCache?: string; offline?: boolean; outDir?: string; chain: string; rpc?: string; privateKey?: string; expiresAt?: string }) => {
    await credentialProve(opts).catch(err);
  });

credential
  .command("zk-root")
  .description("Compute the Merkle root needed for a one-wallet ZK credential demo")
  .requiredOption("-w, --wallet <address>", "Wallet address included in the ZK tree")
  .option("-i, --issuer <address>", "Issuer address, used to print matching public-input hashes")
  .requiredOption("--expires-at <unix>", "Future Unix timestamp; pass the same value to credential prove")
  .action(async (opts: { wallet: string; issuer?: string; expiresAt: string }) => {
    await credentialRoot(opts).catch(err);
  });

credential
  .command("mint")
  .description("Mint a CNF credential using the issuer-configured EAS schema")
  .requiredOption("-a, --attestation <uid>", "EAS attestation UID (0x + 64 hex chars)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--simulate", "Verify attestation without sending tx", false)
  .action(async (opts: { attestation: string; issuer?: string; chain?: string; rpc?: string; privateKey?: string; simulate: boolean }) => {
    await mintCredential(opts).catch(err);
  });

credential
  .command("renew")
  .description("Renew an existing CNF credential with a fresh EAS attestation")
  .requiredOption("-a, --attestation <uid>", "EAS attestation UID (0x + 64 hex chars)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--simulate", "Verify attestation without sending tx", false)
  .action(async (opts: { attestation: string; issuer?: string; chain?: string; rpc?: string; privateKey?: string; simulate: boolean }) => {
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
  .action(async (opts: { proof: string; public: string; issuer: string; chain: string; rpc?: string; privateKey?: string }) => {
    await proofRenew(opts).catch(err);
  });

// ─── session ──────────────────────────────────────────────────────────────────

const session = program.command("session").description("Session token operations");

session
  .command("sign")
  .description("Sign an EIP-712 session token locally — no ILAL API call")
  .option("-p, --pool <bytes32>", "Pool ID (bytes32 hex, defaults to .ilal.json poolId)")
  .requiredOption("-a, --action <action>", "Action: swap | addLiquidity | removeLiquidity")
  .option("-H, --hook <address>", "ComplianceHook contract address (defaults to .ilal.json hook)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (defaults to .ilal.json issuer)")
  .option("-R, --registry <address>", "EligibilityPolicyRegistryV2 address (v2)")
  .option("--protocol-version <version>", "Protocol version: 1 or 2 (defaults to .ilal.json)")
  .option("-u, --user <address>", "Trader address (defaults to key's address)")
  .option("--caller <address>", "Authorized v4 caller (defaults to .ilal.json router, then user)")
  .option("-c, --chain <chainId>", "Chain ID (defaults to .ilal.json chain, then 84532)")
  .option("-t, --ttl <seconds>", "Session lifetime in seconds", "600")
  .action(async (opts: { pool?: string; action: string; hook?: string; issuer?: string; registry?: string; protocolVersion?: string; user?: string; caller?: string; chain?: string; ttl: string; privateKey?: string }) => {
    await sessionSign({ ...opts, ttl: parseInt(opts.ttl, 10) }).catch(err);
  });

// ─── v2 policy grants ───────────────────────────────────────────────────────

const policyV2 = program.command("policy").description("Protocol v2 eligibility policy and grant operations");
const grantsV2 = policyV2.command("grant").description("Short-lived policy grant operations");

grantsV2
  .command("status")
  .description("Read the current pool policy and a wallet's v2 grant")
  .requiredOption("-w, --wallet <address>", "Wallet address")
  .option("-p, --pool <bytes32>", "Pool ID (defaults to .ilal.json poolId)")
  .option("-R, --registry <address>", "EligibilityPolicyRegistryV2 address")
  .option("-G, --grant-manager <address>", "PolicyGrantManagerV2 address")
  .option("-c, --chain <chainId>", "Chain ID (defaults to .ilal.json)")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { wallet: string; pool?: string; registry?: string; grantManager?: string; chain?: string; rpc?: string }) => {
    await policyGrantStatus(opts).catch(err);
  });

grantsV2
  .command("activate")
  .description("Verify a circuit v2 proof and activate a short-lived pool policy grant")
  .requiredOption("--proof <path>", "Path to snarkjs proof.json")
  .requiredOption("--public <path>", "Path to snarkjs public.json")
  .option("-p, --pool <bytes32>", "Pool ID (defaults to .ilal.json poolId)")
  .option("-R, --registry <address>", "EligibilityPolicyRegistryV2 address")
  .option("-G, --grant-manager <address>", "PolicyGrantManagerV2 address")
  .option("-c, --chain <chainId>", "Chain ID (defaults to .ilal.json)")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { proof: string; public: string; pool?: string; registry?: string; grantManager?: string; chain?: string; rpc?: string; privateKey?: string }) => {
    await policyGrantActivate(opts).catch(err);
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
  .option("--max-amount-0 <raw>", "Maximum currency0 spend in raw token units")
  .option("--max-amount-1 <raw>", "Maximum currency1 spend in raw token units")
  .option("--unsafe-no-amount-limits", "Disable LP spend protection (test environments only)", false)
  .option("--salt <bytes32>", "Position salt for multiple positions at the same range (defaults to user-scoped salt)")
  .option("--pool-id <bytes32>", "Pool ID (or set in .ilal.json)")
  .option("--router <address>", "ILALRouter address (or set in .ilal.json)")
  .option("-H, --hook <address>", "ComplianceHook address (or set in .ilal.json)")
  .option("-i, --issuer <address>", "CNFIssuer address (or set in .ilal.json)")
  .option("-R, --registry <address>", "EligibilityPolicyRegistryV2 address (v2)")
  .option("-G, --grant-manager <address>", "PolicyGrantManagerV2 address (v2)")
  .option("--protocol-version <version>", "Protocol version: 1 or 2 (defaults to .ilal.json)")
  .option("--token-a <address>", "currency0 token address (or set in .ilal.json)")
  .option("--token-b <address>", "currency1 token address (or set in .ilal.json)")
  .option("--fee <uint24>", "Pool fee tier (default: config or 3000; 8388608=dynamic)")
  .option("--tick-spacing <int24>", "Tick spacing (default: config or 60)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--ttl <seconds>", "Session token lifetime in seconds", "600")
  .action(async (opts: {
    tickLower: string; tickUpper: string; liquidity: string; salt?: string;
    poolId?: string; router?: string; hook?: string; issuer?: string; registry?: string; grantManager?: string; protocolVersion?: string;
    tokenA?: string; tokenB?: string; fee?: string; tickSpacing?: string;
    chain: string; rpc?: string; privateKey?: string; ttl: string;
    maxAmount0?: string; maxAmount1?: string; unsafeNoAmountLimits: boolean;
  }) => {
    await addLiquidity(opts).catch(err);
  });

pool
  .command("remove-liquidity")
  .description("Remove liquidity from a compliant Uniswap v4 pool through the ILAL channel")
  .requiredOption("--tick-lower <int24>", "Lower tick of position")
  .requiredOption("--tick-upper <int24>", "Upper tick of position")
  .requiredOption("--liquidity <uint128>", "Liquidity amount to remove (in raw units)")
  .option("--min-amount-0 <raw>", "Minimum currency0 receive in raw token units")
  .option("--min-amount-1 <raw>", "Minimum currency1 receive in raw token units")
  .option("--unsafe-no-amount-limits", "Disable LP output protection (test environments only)", false)
  .option("--salt <bytes32>", "Position salt (defaults to user-scoped salt)")
  .option("--pool-id <bytes32>", "Pool ID (or set in .ilal.json)")
  .option("--router <address>", "ILALRouter address (or set in .ilal.json)")
  .option("-H, --hook <address>", "ComplianceHook address (or set in .ilal.json)")
  .option("-i, --issuer <address>", "CNFIssuer address (or set in .ilal.json)")
  .option("-R, --registry <address>", "EligibilityPolicyRegistryV2 address (v2)")
  .option("-G, --grant-manager <address>", "PolicyGrantManagerV2 address (v2)")
  .option("--protocol-version <version>", "Protocol version: 1 or 2 (defaults to .ilal.json)")
  .option("--token-a <address>", "currency0 token address (or set in .ilal.json)")
  .option("--token-b <address>", "currency1 token address (or set in .ilal.json)")
  .option("--fee <uint24>", "Pool fee tier (default: config or 3000; 8388608=dynamic)")
  .option("--tick-spacing <int24>", "Tick spacing (default: config or 60)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--ttl <seconds>", "Session token lifetime in seconds", "600")
  .action(async (opts: {
    tickLower: string; tickUpper: string; liquidity: string; salt?: string;
    poolId?: string; router?: string; hook?: string; issuer?: string; registry?: string; grantManager?: string; protocolVersion?: string;
    tokenA?: string; tokenB?: string; fee?: string; tickSpacing?: string;
    chain: string; rpc?: string; privateKey?: string; ttl: string;
    minAmount0?: string; minAmount1?: string; unsafeNoAmountLimits: boolean;
  }) => {
    await removeLiquidity(opts).catch(err);
  });

// ─── swap ─────────────────────────────────────────────────────────────────────

program
  .command("swap")
  .description("Execute a compliant token swap through the ILAL channel")
  .requiredOption("--amount-in <amount>", "Input amount in human-readable units (e.g. 100)")
  .option("--min-amount-out <raw>", "Required minimum output in raw token units for live swaps")
  .option("--unsafe-no-slippage", "Explicitly disable output protection (test environments only)", false)
  .option("--token-in <address>", "Token to sell (defaults to tokenA from config)")
  .option("--token-a <address>", "currency0 token address (or set in .ilal.json)")
  .option("--token-b <address>", "currency1 token address (or set in .ilal.json)")
  .option("--pool-id <bytes32>", "Pool ID (or set in .ilal.json)")
  .option("--router <address>", "ILALRouter address (or set in .ilal.json)")
  .option("-H, --hook <address>", "ComplianceHook address (or set in .ilal.json)")
  .option("-i, --issuer <address>", "CNFIssuer address (or set in .ilal.json)")
  .option("-R, --registry <address>", "EligibilityPolicyRegistryV2 address (v2)")
  .option("-G, --grant-manager <address>", "PolicyGrantManagerV2 address (v2)")
  .option("--protocol-version <version>", "Protocol version: 1 or 2 (defaults to .ilal.json)")
  .option("--fee <uint24>", "Pool fee tier (default: config or 3000; 8388608=dynamic)")
  .option("--tick-spacing <int24>", "Tick spacing (default: config or 60)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--ttl <seconds>", "Session token lifetime in seconds", "600")
  .option("--hook-data <hex>", "Use externally signed one-time hookData instead of signing inside swap")
  .option("--explain", "Show inline explanations for gate checks and session fields", false)
  .option("--simulate", "Sign session without sending tx", false)
  .action(async (opts: {
    amountIn: string; minAmountOut?: string; unsafeNoSlippage: boolean; tokenIn?: string; tokenA?: string; tokenB?: string;
    poolId?: string; router?: string; hook?: string; issuer?: string; registry?: string; grantManager?: string; protocolVersion?: string;
    fee?: string; tickSpacing?: string; chain: string; rpc?: string;
    privateKey?: string; ttl: string; hookData?: string; explain: boolean; simulate: boolean;
  }) => {
    await swap(opts).catch(err);
  });

// ─── oracle ───────────────────────────────────────────────────────────────────
// Operator-only commands — require owner key.
// Merkle root, verifier, and proof-domain changes are timelocked.

const oracle = program
  .command("oracle")
  .description("Operator commands for managing timelocked ZK trust configuration");

oracle
  .command("propose-root")
  .description("Queue a new Merkle root (step 1 of 2 — owner only, ROOT_DELAY = 48 h timelock)")
  .requiredOption("--root <uint256>", "New Merkle root value (decimal or 0x hex)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { root: string; issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleProposeRoot(opts).catch(err);
  });

oracle
  .command("activate-root")
  .description("Activate the pending Merkle root after the 48-hour timelock has elapsed (step 2 of 2)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
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
  .action(async (opts: { verifier: string; issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleProposeVerifier(opts).catch(err);
  });

oracle
  .command("activate-verifier")
  .description("Activate the pending ZK verifier after the 72-hour timelock has elapsed (step 2 of 2)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleActivateVerifier(opts).catch(err);
  });

oracle
  .command("propose-domain")
  .description("Queue issuer/schema public-input hashes (step 1 of 2 — owner only, 72 h timelock)")
  .requiredOption("--issuer-hash <uint256>", "Poseidon field hash of the CNFIssuer address")
  .requiredOption("--schema-hash <uint256>", "Poseidon field hash of the accepted credential schema")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { issuerHash: string; schemaHash: string; issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleProposeDomain(opts).catch(err);
  });

oracle
  .command("activate-domain")
  .description("Activate pending issuer/schema hashes after the 72-hour timelock (step 2 of 2)")
  .option("-i, --issuer <address>", "CNFIssuer contract address (or set in .ilal.json)")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { issuer?: string; chain: string; rpc?: string; privateKey?: string }) => {
    await oracleActivateDomain(opts).catch(err);
  });

// ─── Safe proposals ─────────────────────────────────────────────────────────

const safe = program.command("safe").description("Build and optionally submit Safe administrative transactions");

safe
  .command("propose")
  .description("Create an offline Safe transaction JSON; submission requires an explicit flag")
  .requiredOption("--to <address>", "Transaction target")
  .requiredOption("--data <hex>", "ABI-encoded calldata")
  .option("--value <wei>", "Native value in wei", "0")
  .option("--operation <0|1>", "0=CALL, 1=DELEGATECALL", "0")
  .option("-c, --chain <chainId>", "Chain ID", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .action(async (opts: { to: string; data: string; value?: string; operation?: string; chain: string; rpc?: string }) => {
    const chain = opts.chain === "8453" ? base : opts.chain === "84532" ? baseSepolia : undefined;
    if (!chain) {
      err(new Error(`Unsupported chain: ${opts.chain}`));
      return;
    }
    await safePropose({ ...opts, chain }).catch(err);
  });

// ─── deploy ───────────────────────────────────────────────────────────────────

program
  .command("deploy")
  .description("Deploy ILAL contracts (PolicyRegistry + CNFIssuer + ComplianceHook)")
  .option("-c, --chain <chainId>", "Chain ID (8453=Base, 84532=Base Sepolia)", "84532")
  .option("-r, --rpc <url>", "Custom RPC URL")
  .option("--broadcast", "Send transactions (omit for dry run)", false)
  .option("--verify", "Verify contracts on Etherscan/Basescan", false)
  .option("--mock", "Use MockEAS for testnet (Base Sepolia only)", false)
  .option("--admin <address>", "Safe/admin that receives CNFIssuer and PolicyRegistry ownership (production only)")
  .option("--eas <address>", "Issuer EAS contract (defaults to the chain EAS contract)")
  .option("--schema <bytes32>", "Issuer EAS schema UID (defaults to Coinbase Account Verification)")
  .option("--attester <address>", "Trusted EAS attester (defaults to Coinbase Verifications)")
  .option("--treasury <address>", "Protocol-fee treasury (defaults to deployer)")
  .option("--protocol-fee-pips <pips>", "Verified-flow protocol fee, 0-1000 (default 50)")
  .option("--issuer-name <name>", "On-chain issuer display name")
  .option("--issuer-jurisdiction <text>", "On-chain issuer jurisdiction descriptor")
  .option("--issuer-standard <text>", "On-chain credential standard descriptor")
  .option("--issuer-uri <uri>", "On-chain issuer metadata URI")
  .option("--wallet-to-seed <address>", "Wallet that receives a seeded test attestation (--mock only)")
  .option("--contracts-dir <path>", "Path to contracts/ directory")
  .action(async (opts: { chain: string; rpc?: string; privateKey?: string; broadcast: boolean; verify: boolean; mock: boolean; admin?: string; eas?: string; schema?: string; attester?: string; treasury?: string; protocolFeePips?: string; issuerName?: string; issuerJurisdiction?: string; issuerStandard?: string; issuerUri?: string; walletToSeed?: string; contractsDir?: string }) => {
    await deploy(opts).catch(err);
  });

program.parse();
