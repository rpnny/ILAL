/**
 * config.ts — ILAL CLI project configuration.
 *
 * Loads from (highest priority first):
 *   1. CLI flags (handled by Commander, passed directly)
 *   2. Environment variables (ILAL_ISSUER, ILAL_CHAIN, etc.)
 *   3. .ilal.json in current dir or any parent dir
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

export interface ILALConfig {
  protocolVersion?: string;   // "1" (CNF) or "2" (policy grant)
  issuer?:      string;   // CNFIssuer address
  hook?:        string;   // ComplianceHook address
  registry?:    string;   // PolicyRegistry address
  grantManager?: string;  // PolicyGrantManagerV2 address
  router?:      string;   // ILALRouter address
  treasury?:    string;   // ILAL protocol fee receiver
  tokenA?:      string;   // Default currency0 token address
  tokenB?:      string;   // Default currency1 token address
  poolId?:      string;   // Default pool ID (bytes32 hex)
  fee?:         string;   // Pool fee tier; 8388608 means v4 dynamic fee
  tickSpacing?: string;   // Pool tick spacing
  chain?:       string;   // chainId string
  rpc?:         string;   // RPC URL
  circuitDir?:  string;   // path to circuits/build
  artifactUrl?: string;   // hosted proving artifact base URL
  artifactCache?: string; // local proving artifact cache directory
  outDir?:      string;   // proof output directory
}

const CONFIG_FILE = ".ilal.json";

// ─── Find config file ─────────────────────────────────────────────────────────

function findConfigFile(startDir = process.cwd()): string | null {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Load config ──────────────────────────────────────────────────────────────

let _config: ILALConfig | null = null;

export function loadConfig(): ILALConfig {
  if (_config) return _config;

  // Start with file config
  const filePath = findConfigFile();
  let fileConfig: ILALConfig = {};
  if (filePath) {
    try {
      fileConfig = JSON.parse(readFileSync(filePath, "utf8")) as ILALConfig;
    } catch { /* malformed, ignore */ }
  }

  // Overlay env vars
  _config = {
    protocolVersion: process.env["ILAL_PROTOCOL_VERSION"] ?? fileConfig.protocolVersion,
    issuer:     process.env["ILAL_ISSUER"]      ?? fileConfig.issuer,
    hook:       process.env["ILAL_HOOK"]        ?? fileConfig.hook,
    registry:   process.env["ILAL_REGISTRY"]    ?? fileConfig.registry,
    grantManager: process.env["ILAL_GRANT_MANAGER"] ?? fileConfig.grantManager,
    router:     process.env["ILAL_ROUTER"]      ?? fileConfig.router,
    treasury:   process.env["ILAL_TREASURY"]    ?? fileConfig.treasury,
    tokenA:     process.env["ILAL_TOKEN_A"]     ?? fileConfig.tokenA,
    tokenB:     process.env["ILAL_TOKEN_B"]     ?? fileConfig.tokenB,
    poolId:     process.env["ILAL_POOL_ID"]     ?? fileConfig.poolId,
    fee:        process.env["ILAL_FEE"]         ?? fileConfig.fee,
    tickSpacing: process.env["ILAL_TICK_SPACING"] ?? fileConfig.tickSpacing,
    chain:      process.env["ILAL_CHAIN"]       ?? fileConfig.chain,
    rpc:        process.env["ILAL_RPC"]         ?? fileConfig.rpc,
    circuitDir: process.env["ILAL_CIRCUIT_DIR"] ?? fileConfig.circuitDir,
    artifactUrl: process.env["ILAL_ARTIFACT_BASE_URL"]
      ?? process.env["ILAL_ARTIFACT_URL"]
      ?? fileConfig.artifactUrl,
    artifactCache: process.env["ILAL_ARTIFACT_CACHE"] ?? fileConfig.artifactCache,
    outDir:     process.env["ILAL_OUT_DIR"]     ?? fileConfig.outDir,
  };

  return _config;
}

/** Merge CLI flags over config (undefined flags don't override) */
export function withConfig<T extends Partial<ILALConfig>>(flags: T): T & ILALConfig {
  const cfg = loadConfig();
  return {
    ...cfg,
    ...Object.fromEntries(
      Object.entries(flags).filter(([, v]) => v !== undefined)
    ),
  } as T & ILALConfig;
}

// ─── Write config ─────────────────────────────────────────────────────────────

export function writeConfig(config: ILALConfig, dir = process.cwd()): string {
  const path = resolve(dir, CONFIG_FILE);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
  return path;
}

export function configFilePath(): string | null {
  return findConfigFile();
}
