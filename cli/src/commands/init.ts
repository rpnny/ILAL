/**
 * init.ts — `ilal init`
 *
 * Creates a .ilal.json config file in the current directory so you never
 * have to pass --issuer, --chain, etc. on every command.
 */

import { isAddress } from "viem";
import { writeConfig, configFilePath } from "../config.js";
import { fmt, log, header, die } from "../ui.js";
import { ACTIVE_PRESETS } from "../generated/deployments.js";

// Network defaults. Contract presets are generated only from active deployment manifests.
const PRESETS: Record<string, Record<string, string>> = {
  "84532": {
    rpc:         "https://sepolia.base.org",
  },
  "8453": {
    rpc: "https://mainnet.base.org",
  },
};

export async function init(opts: {
  protocolVersion: string;
  issuer?:    string;
  hook?:      string;
  registry?:  string;
  grantManager?: string;
  router?:    string;
  treasury?:  string;
  tokenA?:    string;
  tokenB?:    string;
  poolId?:    string;
  fee?:       string;
  tickSpacing?: string;
  chain:      string;
  rpc?:       string;
  circuitDir?: string;
  artifactUrl?: string;
  artifactCache?: string;
  force:      boolean;
}) {
  header("ILAL Init", "Creating .ilal.json in current directory");

  const existing = configFilePath();
  if (existing && !opts.force) {
    log.warn(`Config already exists: ${fmt.cyan(existing)}`);
    log.info(`Use ${fmt.cyan("--force")} to overwrite.`);
    console.log();
    return;
  }

  // Start with preset for the chain
  const preset = { ...(PRESETS[opts.chain] ?? {}), ...(ACTIVE_PRESETS[opts.chain] ?? {}) };

  const config = {
    protocolVersion: opts.protocolVersion,
    chain:      opts.chain,
    issuer:     opts.issuer     ?? preset["issuer"],
    hook:       opts.hook       ?? preset["hook"],
    registry:   opts.registry   ?? preset["registry"],
    grantManager: opts.grantManager ?? preset["grantManager"],
    router:     opts.router     ?? preset["router"],
    treasury:   opts.treasury   ?? preset["treasury"],
    tokenA:     opts.tokenA     ?? preset["tokenA"],
    tokenB:     opts.tokenB     ?? preset["tokenB"],
    poolId:     opts.poolId     ?? preset["poolId"],
    fee:        opts.fee        ?? preset["fee"],
    tickSpacing: opts.tickSpacing ?? preset["tickSpacing"],
    rpc:        opts.rpc        ?? preset["rpc"],
    ...(opts.circuitDir ? { circuitDir: opts.circuitDir } : {}),
    ...(opts.artifactUrl ? { artifactUrl: opts.artifactUrl } : {}),
    ...(opts.artifactCache ? { artifactCache: opts.artifactCache } : {}),
  };

  // Validate addresses
  for (const [key, val] of Object.entries(config)) {
    if (val && (key === "issuer" || key === "hook" || key === "registry" || key === "grantManager" || key === "router" || key === "treasury" || key === "tokenA" || key === "tokenB")) {
      if (!isAddress(val)) die(`Invalid ${key} address: ${val}`);
    }
  }

  const path = writeConfig(config);

  log.ok(`Created ${fmt.cyan(path)}`);
  if (!ACTIVE_PRESETS[opts.chain]) {
    log.warn("No active ILAL deployment is published for this chain. Only network settings were written.");
    log.info("Supply explicit contract addresses after deploying a stack; deprecated demo addresses are never selected automatically.");
  }
  log.line();

  if (config.chain)    log.kv("chain",    config.chain === "84532" ? "Base Sepolia" : "Base");
  log.kv("protocol", `v${config.protocolVersion}`);
  if (config.issuer)   log.kv("issuer",   fmt.cyan(config.issuer));
  if (config.hook)     log.kv("hook",     fmt.cyan(config.hook));
  if (config.registry) log.kv("registry", fmt.cyan(config.registry));
  if (config.grantManager) log.kv("grantManager", fmt.cyan(config.grantManager));
  if (config.router)   log.kv("router",   fmt.cyan(config.router));
  if (config.treasury) log.kv("treasury", fmt.cyan(config.treasury));
  if (config.tokenA)   log.kv("tokenA",   fmt.cyan(config.tokenA));
  if (config.tokenB)   log.kv("tokenB",   fmt.cyan(config.tokenB));
  if (config.poolId)   log.kv("poolId",   fmt.hash(config.poolId));
  if (config.fee)      log.kv("fee",      config.fee === "8388608" ? "dynamic" : config.fee);
  if (config.tickSpacing) log.kv("tickSpacing", config.tickSpacing);
  if (config.rpc)      log.kv("rpc",      config.rpc);
  if (config.artifactUrl) log.kv("artifactUrl", config.artifactUrl);
  if (config.artifactCache) log.kv("artifactCache", config.artifactCache);

  log.line();
  console.log(`  ${fmt.gray("You can now run commands without --issuer and --chain flags:")}`);
  console.log();
  console.log(`  ${fmt.cyan("ilal credential prove --wallet 0x...")}`);
  console.log(`  ${fmt.cyan("ilal status --wallet 0x...")}`);
  console.log();
}
