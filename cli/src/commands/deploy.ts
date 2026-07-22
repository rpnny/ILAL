import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { isAddress } from "viem";
import { isHex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, die } from "../ui.js";
import { EAS_ADDRESSES, COINBASE_ATTESTER, COINBASE_SCHEMA_UID } from "../constants.js";
import { forgeSignerForExternalProcess } from "../signer.js";

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
  admin?: string;
  eas?: string;
  schema?: string;
  attester?: string;
  treasury?: string;
  protocolFeePips?: string;
  issuerName?: string;
  issuerJurisdiction?: string;
  issuerStandard?: string;
  issuerUri?: string;
}) {
  if (opts.admin && !isAddress(opts.admin)) die(`Invalid admin address: ${opts.admin}`);
  if (opts.mock && (opts.eas || opts.attester)) die("--mock deploys MockEAS; omit --eas and --attester.");
  if (opts.eas && !isAddress(opts.eas)) die(`Invalid EAS address: ${opts.eas}`);
  if (opts.attester && !isAddress(opts.attester)) die(`Invalid attester address: ${opts.attester}`);
  if (opts.treasury && !isAddress(opts.treasury)) die(`Invalid treasury address: ${opts.treasury}`);
  if (opts.schema && (!isHex(opts.schema) || opts.schema.length !== 66)) {
    die("Invalid schema UID: expected 0x + 32 bytes.");
  }
  const protocolFeePips = opts.protocolFeePips === undefined ? undefined : Number(opts.protocolFeePips);
  if (protocolFeePips !== undefined && (!Number.isInteger(protocolFeePips) || protocolFeePips < 0 || protocolFeePips > 1000)) {
    die("--protocol-fee-pips must be an integer from 0 to 1000 (maximum 0.10%).");
  }
  const chainId = opts.chain;
  const poolManager = POOL_MANAGERS[chainId];
  if (!poolManager) die(`Unsupported chain: ${chainId}. Supported: 8453 (Base), 84532 (Base Sepolia).`);
  if (opts.broadcast && !opts.admin) die("Broadcast deployment requires --admin <Safe>; the deployer cannot retain protocol ownership.");
  if (opts.broadcast && !opts.treasury) die("Broadcast deployment requires an explicit --treasury <address>.");
  const chain = chainId === "8453" ? base : baseSepolia;

  const easAddress = opts.eas ?? EAS_ADDRESSES[parseInt(chainId)];
  if (!easAddress) die(`No EAS address for chain ${chainId}.`);

  const rpc = opts.rpc ?? RPC_URLS[chainId] ?? die(`No default RPC for chain ${chainId}. Use --rpc.`);
  const forgeSigner = await forgeSignerForExternalProcess({ chain, rpc, legacyPrivateKey: opts.privateKey });

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
    log.kv("attester", opts.attester ?? COINBASE_ATTESTER);
    log.kv("schemaUID", (opts.schema ?? COINBASE_SCHEMA_UID).slice(0, 20) + "...");
    if (protocolFeePips !== undefined) log.kv("protocol fee", `${protocolFeePips} pips`);
  }
  log.kv("admin owner", opts.admin ?? fmt.yellow("deployer (dry-run/test only)"));
  log.kv("treasury", opts.treasury ?? fmt.yellow("deployer (dry-run/test only)"));
  log.kv("broadcast", opts.broadcast ? fmt.yellow("yes - tx will be sent") : "no (dry run)");
  log.line();

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...forgeSigner.environment,
    DEPLOYER: forgeSigner.address,
    POOL_MANAGER: poolManager,
  };
  if (forgeSigner.kind !== "unsafe-private-key") delete env["PRIVATE_KEY"];
  delete env["ETH_PASSWORD"];
  delete env["MNEMONIC"];

  if (isMock) {
    env["WALLET_TO_SEED"] = opts.walletToSeed!;
    env["WALLET"] = opts.walletToSeed!;
    env["MOCK_EAS"] = "true";
    if (opts.admin) env["ADMIN"] = opts.admin;
    if (opts.schema) env["SCHEMA_UID"] = opts.schema;
  } else {
    env["EAS_ADDRESS"] = easAddress;
    env["SCHEMA_UID"] = opts.schema ?? COINBASE_SCHEMA_UID;
    env["TRUSTED_ATTESTER"] = opts.attester ?? COINBASE_ATTESTER;
    if (opts.admin) env["ADMIN"] = opts.admin;
  }
  if (opts.treasury) env["TREASURY"] = opts.treasury;
  if (protocolFeePips !== undefined) env["PROTOCOL_FEE_PIPS"] = protocolFeePips.toString();
  if (opts.issuerName) env["ISSUER_NAME"] = opts.issuerName;
  if (opts.issuerJurisdiction) env["ISSUER_JURISDICTION"] = opts.issuerJurisdiction;
  if (opts.issuerStandard) env["ISSUER_STANDARD"] = opts.issuerStandard;
  if (opts.issuerUri) env["ISSUER_URI"] = opts.issuerUri;

  const script = isMock ? "script/DeployDemo.s.sol" : "script/Deploy.s.sol";

  const args = [
    "script",
    script,
    "--rpc-url",
    rpc,
    ...(opts.broadcast ? ["--broadcast"] : []),
    ...(opts.verify ? ["--verify"] : []),
    ...forgeSigner.args,
    "--slow",
  ];

  log.step(`Running: ${fmt.gray(`forge ${args.map((arg) => JSON.stringify(arg)).join(" ")}`)}`);
  console.log();

  try {
    execFileSync("forge", args, {
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
