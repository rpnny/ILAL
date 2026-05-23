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
    issuer:      "0xc4E032A7574016bd0e3d1a5BbFdE886af09CeD9A",
    hook:        "0xF5066ad9c25F3f54cfb19609A60187C48C184A80",
    registry:    "0x910a3efDc426f3216738106dd0DC6EA696477233",
    router:      "0x7727F0f3EBe99A558487394D001950ee6B33BB86",
    treasury:    "0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38",
    tokenA:      "0x582362E608F36850F6f641510d5D19C1EaB4cb27",
    tokenB:      "0x6eBBdAC70EC422C512727B25c7F0D9120ed101Ff",
    poolId:      "0xc1c8f29d6f03b5cd18bf2b862d48f45cc338022a154945b89c4bcb0a3e11e87f",
    fee:         "8388608",
    tickSpacing: "60",
    rpc:         "https://sepolia.base.org",
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
    router:     opts.router     ?? preset["router"],
    treasury:   opts.treasury   ?? preset["treasury"],
    tokenA:     opts.tokenA     ?? preset["tokenA"],
    tokenB:     opts.tokenB     ?? preset["tokenB"],
    poolId:     opts.poolId     ?? preset["poolId"],
    fee:        opts.fee        ?? preset["fee"],
    tickSpacing: opts.tickSpacing ?? preset["tickSpacing"],
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
