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
    issuer:      "0x33541301e35d33eDf554c4DFba1e04d04FCc52F4",
    hook:        "0x5f1de4376C7a59b5BBC5E5cd766D40995E9e4A80",
    registry:    "0x83d8111B415E97bA91eaAe717c2D9Ae6f0DD19d4",
    router:      "0x88125331f169aF4Dc81ADa6E8A189110566E457a",
    treasury:    "0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38",
    tokenA:      "0x3d5b92a8Cea5BBe1c6f63b73D69DA6457e6436E2",
    tokenB:      "0x6145F81e3691d991a4D2033FE25BeB140487B7Ee",
    poolId:      "0x8b6d21e53673584f192bdad8b65e2002e9e8eea730c62adad5ac1f4a084164a4",
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
