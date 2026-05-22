/**
 * init.ts — `ilal init`
 *
 * Creates a .ilal.json config file in the current directory so you never
 * have to pass --issuer, --chain, etc. on every command.
 */

import { isAddress } from "viem";
import { writeConfig, configFilePath } from "../config.js";
import { fmt, log, header, die } from "../ui.js";

// Known testnet / mainnet addresses for quick init
const PRESETS: Record<string, Record<string, string>> = {
  "84532": {
    issuer:   "0x319c0F1cb46c85B42E051251c4db04BA6BD265a2",
    hook:     "0xdFF2ebBAc963f5Ed0B0EBCf021aB5EA16d57ea94",
    registry: "0x72A425672c1D0FA95C75F5073e6DAf72194A1E0F",
    rpc:      "https://sepolia.base.org",
  },
  "8453": {
    rpc: "https://mainnet.base.org",
  },
};

export async function init(opts: {
  issuer?:    string;
  hook?:      string;
  registry?:  string;
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
  const preset = PRESETS[opts.chain] ?? {};

  const config = {
    chain:      opts.chain,
    issuer:     opts.issuer     ?? preset["issuer"],
    hook:       opts.hook       ?? preset["hook"],
    registry:   opts.registry   ?? preset["registry"],
    router:     opts.router,
    treasury:   opts.treasury,
    tokenA:     opts.tokenA,
    tokenB:     opts.tokenB,
    poolId:     opts.poolId,
    fee:        opts.fee,
    tickSpacing: opts.tickSpacing,
    rpc:        opts.rpc        ?? preset["rpc"],
    ...(opts.circuitDir ? { circuitDir: opts.circuitDir } : {}),
  };

  // Validate addresses
  for (const [key, val] of Object.entries(config)) {
    if (val && (key === "issuer" || key === "hook" || key === "registry" || key === "router" || key === "treasury" || key === "tokenA" || key === "tokenB")) {
      if (!isAddress(val)) die(`Invalid ${key} address: ${val}`);
    }
  }

  const path = writeConfig(config);

  log.ok(`Created ${fmt.cyan(path)}`);
  log.line();

  if (config.chain)    log.kv("chain",    config.chain === "84532" ? "Base Sepolia" : "Base");
  if (config.issuer)   log.kv("issuer",   fmt.cyan(config.issuer));
  if (config.hook)     log.kv("hook",     fmt.cyan(config.hook));
  if (config.registry) log.kv("registry", fmt.cyan(config.registry));
  if (config.router)   log.kv("router",   fmt.cyan(config.router));
  if (config.treasury) log.kv("treasury", fmt.cyan(config.treasury));
  if (config.tokenA)   log.kv("tokenA",   fmt.cyan(config.tokenA));
  if (config.tokenB)   log.kv("tokenB",   fmt.cyan(config.tokenB));
  if (config.poolId)   log.kv("poolId",   fmt.hash(config.poolId));
  if (config.fee)      log.kv("fee",      config.fee === "8388608" ? "dynamic" : config.fee);
  if (config.tickSpacing) log.kv("tickSpacing", config.tickSpacing);
  if (config.rpc)      log.kv("rpc",      config.rpc);

  log.line();
  console.log(`  ${fmt.gray("You can now run commands without --issuer and --chain flags:")}`);
  console.log();
  console.log(`  ${fmt.cyan("ilal credential prove --wallet 0x...")}`);
  console.log(`  ${fmt.cyan("ilal status --wallet 0x...")}`);
  console.log();
}
