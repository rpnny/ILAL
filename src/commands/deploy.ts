import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { fmt, log, die, requirePrivateKey } from "../ui.js";
import { EAS_ADDRESSES, COINBASE_ATTESTER, COINBASE_SCHEMA_UID } from "../constants.js";

const POOL_MANAGERS: Record<string, string> = {
  "8453":  "0x498581ff718922c3f8e6a244956af099b2652b2b", // Base mainnet
  "84532": "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408", // Base Sepolia
};

const RPC_URLS: Record<string, string> = {
  "8453":  "https://mainnet.base.org",
  "84532": "https://sepolia.base.org",
};

export async function deploy(opts: {
  chain: string;
  rpc?: string;
  privateKey?: string;
  broadcast: boolean;
  verify: boolean;
  mock: boolean;
  walletToSeed?: string;
  contractsDir?: string;
}) {
  const privateKey = requirePrivateKey(opts.privateKey ?? process.env["PRIVATE_KEY"]);

  const chainId = opts.chain;
  const poolManager = POOL_MANAGERS[chainId];
  if (!poolManager) die(`Unsupported chain: ${chainId}. Supported: 8453 (Base), 84532 (Base Sepolia).`);

  const easAddress = EAS_ADDRESSES[parseInt(chainId)];
  if (!easAddress) die(`No EAS address for chain ${chainId}.`);

  const rpc = opts.rpc ?? RPC_URLS[chainId] ?? die(`No default RPC for chain ${chainId}. Use --rpc.`);

  // Find contracts directory
  const contractsDir = opts.contractsDir
    ? resolve(opts.contractsDir)
    : resolve(process.cwd(), "../contracts");

  if (!existsSync(resolve(contractsDir, "foundry.toml"))) {
    die(`Contracts directory not found at ${contractsDir}.\nUse --contracts-dir or run from the ilal project root.`);
  }

  const isMock = opts.mock;
  if (isMock && chainId === "8453") die("--mock is for testnets only. Use --chain 84532.");
  if (isMock && !opts.walletToSeed) die("--mock requires --wallet-to-seed <address>.");

  console.log();
  console.log(fmt.bold(`  ILAL Protocol Deploy${isMock ? fmt.yellow(" [MOCK / TESTNET]") : ""}`));
  log.line();
  log.kv("chain", chainId === "8453" ? "Base mainnet" : "Base Sepolia");
  log.kv("poolManager", poolManager);
  if (isMock) {
    log.kv("eas", fmt.yellow("MockEAS (testnet only)"));
    log.kv("walletToSeed", opts.walletToSeed!);
  } else {
    log.kv("eas", easAddress);
    log.kv("attester", COINBASE_ATTESTER);
    log.kv("schemaUID", COINBASE_SCHEMA_UID.slice(0, 20) + "...");
  }
  log.kv("broadcast", opts.broadcast ? fmt.yellow("yes - tx will be sent") : "no (dry run)");
  log.line();

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PRIVATE_KEY: privateKey,
    POOL_MANAGER: poolManager,
  };

  if (isMock) {
    env["WALLET_TO_SEED"] = opts.walletToSeed!;
    env["WALLET"] = opts.walletToSeed!;
    env["MOCK_EAS"] = "true";
  } else {
    env["EAS_ADDRESS"] = easAddress;
    env["SCHEMA_UID"] = COINBASE_SCHEMA_UID;
    env["TRUSTED_ATTESTER"] = COINBASE_ATTESTER;
  }

  const script = isMock ? "script/DeployDemo.s.sol" : "script/Deploy.s.sol";

  const flags = [
    `--rpc-url ${rpc}`,
    opts.broadcast ? "--broadcast" : "",
    opts.verify ? "--verify" : "",
    "--slow",
  ].filter(Boolean).join(" ");

  const cmd = `forge script ${script} ${flags}`;

  log.step(`Running: ${fmt.gray(cmd)}`);
  console.log();

  try {
    execSync(cmd, {
      cwd: contractsDir,
      env,
      stdio: "inherit",
    });
    console.log();
    log.ok(fmt.bold(fmt.green("Deployment complete")));
    if (opts.broadcast) {
      log.step("Update your CLI commands with the deployed addresses:");
      console.log(`  ${fmt.gray("ilal pool policy set --registry <PolicyRegistry> --issuer <CNFIssuer> ...")}`);
    }
  } catch {
    die("forge script failed. Check output above.");
  }
  console.log();
}
