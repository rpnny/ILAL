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
    hook:        "0x604f06000E7424E3AA432aB9378D4839Edeb8A80",
    registry:    "0x83d8111B415E97bA91eaAe717c2D9Ae6f0DD19d4",
    router:      "0x805A7654bDCfF1286652de29D2aE906a87e2a912",
    treasury:    "0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58",
    tokenA:      "0x5F6556DF0260A6Bc3613356CAC3c01f727578774",
    tokenB:      "0x6Eb54Ee03474d09B98c6bd9a479Ca2d3ec39469A",
    poolId:      "0xf3a6493827291a485652ae73e1ef5d673c2ad6f0e8df9ed0f54b3725fc42828e",
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
    ...(opts.artifactUrl ? { artifactUrl: opts.artifactUrl } : {}),
    ...(opts.artifactCache ? { artifactCache: opts.artifactCache } : {}),
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
  if (config.artifactUrl) log.kv("artifactUrl", config.artifactUrl);
  if (config.artifactCache) log.kv("artifactCache", config.artifactCache);

  log.line();
  console.log(`  ${fmt.gray("You can now run commands without --issuer and --chain flags:")}`);
  console.log();
  console.log(`  ${fmt.cyan("ilal credential prove --wallet 0x...")}`);
  console.log(`  ${fmt.cyan("ilal status --wallet 0x...")}`);
  console.log();
}
