import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatUnits,
  http,
  isAddress,
  isHex,
  parseUnits,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { loadConfig } from "../config.js";
import { die, fmt, header, log, Spinner, requirePrivateKey } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };
const POOL_MANAGER: Record<string, `0x${string}`> = {
  "84532": "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
  "8453": "0x498581fF718922c3f8e6A244956aF099B2652b2b",
};

const SAMPLE = {
  wallet: "0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58",
  issuer: "0x33541301e35d33eDf554c4DFba1e04d04FCc52F4",
  hook: "0x604f06000E7424E3AA432aB9378D4839Edeb8A80",
  router: "0x805A7654bDCfF1286652de29D2aE906a87e2a912",
  pool: "0xf3a6493827291a485652ae73e1ef5d673c2ad6f0e8df9ed0f54b3725fc42828e",
  proof: "0x91f2b8a0c43e902f7f1a8c0d",
  session: "0x6b84eac5e0db21f8d5d43b7a",
};

const ZERO = "0x0000000000000000000000000000000000000000";

const CNF_ABI = [
  { name: "isValid", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "credentialOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "merkleRoot", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint256" as const }] },
  { name: "zkVerifier", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "eas", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "issuerMetadata", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [
    { name: "name", type: "string" as const },
    { name: "jurisdiction", type: "string" as const },
    { name: "credentialStandard", type: "string" as const },
    { name: "uri", type: "string" as const },
  ] },
] as const;

const REGISTRY_ABI = [
  { name: "getPolicy", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "poolId", type: "bytes32" as const }], outputs: [{ type: "tuple" as const, components: [{ name: "cnfIssuer", type: "address" as const }, { name: "requiredCredentialType", type: "bytes32" as const }, { name: "enabled", type: "bool" as const }] }] },
] as const;

const ROUTER_ABI = [
  { name: "protocolFeePips", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint24" as const }] },
  { name: "treasury", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

const ERC20_ABI = [
  { name: "symbol", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "string" as const }] },
  { name: "decimals", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint8" as const }] },
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "owner", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "allowance", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "owner", type: "address" as const }, { name: "spender", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "mint", type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "to", type: "address" as const }, { name: "amount", type: "uint256" as const }], outputs: [] },
] as const;

const MOCK_EAS_ABI = [
  {
    type: "event" as const,
    name: "AttestationCreated",
    inputs: [
      { name: "uid", type: "bytes32" as const, indexed: true },
      { name: "recipient", type: "address" as const, indexed: true },
      { name: "attester", type: "address" as const, indexed: true },
    ],
  },
  {
    name: "attest",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "schema", type: "bytes32" as const },
      { name: "recipient", type: "address" as const },
      { name: "attester", type: "address" as const },
      { name: "expirationTime", type: "uint64" as const },
      { name: "data", type: "bytes" as const },
    ],
    outputs: [{ type: "bytes32" as const }],
  },
] as const;

function stage(n: number, title: string, subtitle: string) {
  console.log();
  console.log(`  ${fmt.badge(`step ${n}`, "cyan")} ${fmt.bold(title)}`);
  console.log(`  ${fmt.gray(subtitle)}`);
}

function verdict(label: string, value: string, tone: "green" | "yellow" | "red" | "cyan") {
  console.log(`  ${tone === "green" ? fmt.green("●") : tone === "yellow" ? fmt.yellow("●") : tone === "red" ? fmt.red("●") : fmt.cyan("●")} ${fmt.gray(label.padEnd(20))} ${value}`);
}

function flowStep(label: string, value: string, tone: "green" | "yellow" | "red" | "cyan" = "cyan") {
  const color = tone === "green" ? fmt.green : tone === "yellow" ? fmt.yellow : tone === "red" ? fmt.red : fmt.cyan;
  console.log(`  ${color("●")} ${fmt.gray(label.padEnd(14))} ${value}`);
}

function pipsToPercent(pips: number): string {
  return `${(pips / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

export async function demo(opts: { commands?: boolean }) {
  header("Institutional DeFi Demo", "local preview");

  log.section("Thesis");
  log.kv("problem", "institutions face a compliance / cost / privacy trilemma");
  log.kv("answer", "verified eligibility becomes low-cost private trading access");
  log.kv("native layer", "Uniswap v4 Hook, not a wrapper or critical-path API");
  log.kv("demo proof", "real Base Sepolia liquidity + swap through PoolManager");
  log.line();

  stage(1, "Non-eligible wallet attempts to trade", "The pool rejects access before swap execution.");
  verdict("wallet", fmt.addr("0x000000000000000000000000000000000000dEaD"), "cyan");
  verdict("credential", fmt.badge("missing", "red"), "red");
  verdict("hook check", "beforeSwap -> CredentialInvalid", "red");
  verdict("result", fmt.badge("reverted", "red") + " no trade, no bypass", "red");

  stage(2, "Verified trader mints a CNF credential", "Coinbase EAS or ZK proof creates an expiring, non-transferable credential.");
  verdict("wallet", fmt.addr(SAMPLE.wallet), "cyan");
  verdict("issuer", fmt.addr(SAMPLE.issuer), "cyan");
  verdict("proof", fmt.hash(SAMPLE.proof), "cyan");
  verdict("credential", fmt.badge("valid", "green") + " expires in 90d", "green");

  stage(3, "Trader signs a local session", "No API call. No gas. Session binds user + authorized caller + pool + action.");
  verdict("user", fmt.addr(SAMPLE.wallet), "cyan");
  verdict("caller", fmt.addr(SAMPLE.router), "cyan");
  verdict("pool", fmt.hash(SAMPLE.pool), "cyan");
  verdict("session", fmt.hash(SAMPLE.session), "cyan");
  verdict("cost", fmt.badge("0 gas", "green") + " local EIP-712 signature", "green");

  stage(4, "Compliant swap executes through the Hook", "The Hook enforces policy, credential type, caller binding, and nonce replay protection.");
  verdict("hook", fmt.addr(SAMPLE.hook), "cyan");
  verdict("policy", fmt.badge("configured", "green") + " required CNF type matched", "green");
  verdict("nonce", fmt.badge("unused", "green") + " consumed on success", "green");
  verdict("result", fmt.badge("swap allowed", "green") + " institutional liquidity path opened", "green");

  console.log();
  log.section("What Changed Since The Prototype");
  log.kv("before", "API verified proofs and activated sessions");
  log.kv("now", "CLI/SDK generate locally; contracts enforce on-chain");
  log.kv("trust path", fmt.badge("no API critical path", "green") + " Hook-native enforcement");
  log.line();

  log.result("Pitch line", "ILAL solves the compliance-cost-privacy trilemma for institutional DeFi.", "cyan");

  if (opts.commands) {
    console.log();
    log.section("Live Demo Commands");
    log.command("ilal status --wallet <wallet>");
    log.command("ilal credential prove --wallet <wallet>");
    log.command("ilal session sign --pool <poolId> --action swap --hook <hook> --issuer <issuer> --caller <router>");
    log.command("ilal swap --amount-in 100 --token-in <token> --pool-id <poolId> --min-amount-out 0");
  }

  console.log();
}

function ok(label: string, value: string) {
  console.log(`  ${fmt.green("●")} ${fmt.gray(label.padEnd(20))} ${value}`);
}

function warn(label: string, value: string) {
  console.log(`  ${fmt.yellow("●")} ${fmt.gray(label.padEnd(20))} ${value}`);
}

function bad(label: string, value: string) {
  console.log(`  ${fmt.red("●")} ${fmt.gray(label.padEnd(20))} ${value}`);
}

async function hasCode(client: ReturnType<typeof createPublicClient>, label: string, address?: string): Promise<boolean> {
  if (!address) {
    bad(label, fmt.badge("missing", "red"));
    return false;
  }
  if (!isAddress(address)) {
    bad(label, `invalid address ${address}`);
    return false;
  }
  try {
    const code = await client.getBytecode({ address: address as `0x${string}` });
    if (code && code !== "0x") {
      ok(label, fmt.addr(address));
      return true;
    }
    bad(label, `${fmt.addr(address)} ${fmt.badge("no code", "red")}`);
    return false;
  } catch (e) {
    bad(label, e instanceof Error ? e.message.split("\n")[0]! : String(e));
    return false;
  }
}

export async function demoCheck(opts: { wallet?: string; privateKey?: string }) {
  const cfg = loadConfig();
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const client = createPublicClient({ chain, transport: http(cfg.rpc) });
  const rawKey = opts.privateKey ?? process.env["PRIVATE_KEY"];
  const wallet = opts.wallet
    ?? (rawKey && isHex(rawKey) && rawKey.length === 66 ? privateKeyToAccount(rawKey as `0x${string}`).address : undefined);

  header("Live Demo Preflight", chain.name);
  log.deal([
    { label: "Private proof", value: "ZK/CNF", note: "eligibility without full identity", tone: "cyan" },
    { label: "Verified LP fee", value: "0.05%", note: "dynamic fee override", tone: "green" },
    { label: "ILAL protocol fee", value: "0.005%", note: "on-chain verified flow revenue", tone: "cyan" },
  ]);
  log.line();

  let score = 0;
  let total = 0;
  let networkReady = false;
  let configReady = true;
  let codeReady = true;
  let economicsReady = false;
  let issuerPathReady = false;
  let credentialReady = false;
  let policyReady = false;
  let walletBalancesReady = false;
  const walletBalanceChecks: boolean[] = [];

  const pass = (condition: boolean) => {
    total++;
    if (condition) score++;
  };

  log.section("Network");
  log.kv("rpc", cfg.rpc ?? "default viem transport");
  try {
    const block = await client.getBlockNumber();
    ok("latest block", block.toString());
    networkReady = true;
    pass(true);
  } catch (e) {
    bad("latest block", e instanceof Error ? e.message.split("\n")[0]! : String(e));
    pass(false);
  }
  log.line();

  log.section("Configuration", "addresses that define the live path");
  const configItems: Array<[string, string | undefined, "address" | "bytes32" | "text"]> = [
    ["issuer", cfg.issuer, "address"],
    ["hook", cfg.hook, "address"],
    ["registry", cfg.registry, "address"],
    ["router", cfg.router, "address"],
    ["treasury", cfg.treasury, "address"],
    ["currency0", cfg.tokenA, "address"],
    ["currency1", cfg.tokenB, "address"],
    ["poolId", cfg.poolId, "bytes32"],
    ["fee", cfg.fee ?? "3000", "text"],
    ["tickSpacing", cfg.tickSpacing ?? "60", "text"],
  ];
  for (const [label, value, kind] of configItems) {
    const valid = !!value && (kind === "address" ? isAddress(value) : kind === "bytes32" ? isHex(value) && value.length === 66 : true);
    if (valid) {
      const display = kind === "bytes32"
        ? fmt.hash(value!)
        : kind === "address"
          ? fmt.addr(value!)
          : label === "fee" && value === "8388608"
            ? `${fmt.badge("dynamic", "green")} verified flow 0.05%`
            : value!;
      ok(label, display);
    }
    else {
      bad(label, fmt.badge("missing", "red"));
      configReady = false;
    }
    pass(valid);
  }
  log.line();

  log.section("Contract Code", "must exist on-chain");
  const codeChecks = [
    await hasCode(client, "CNFIssuer", cfg.issuer),
    await hasCode(client, "ComplianceHook", cfg.hook),
    await hasCode(client, "PolicyRegistry", cfg.registry),
    await hasCode(client, "ILALRouter", cfg.router),
    await hasCode(client, "currency0", cfg.tokenA),
    await hasCode(client, "currency1", cfg.tokenB),
  ];
  for (const check of codeChecks) pass(check);
  codeReady = codeChecks.every(Boolean);
  log.line();

  if (cfg.router && isAddress(cfg.router)) {
    log.section("Verified Flow Economics");
    try {
      const [protocolFeePips, treasury] = await Promise.all([
        client.readContract({ address: cfg.router as `0x${string}`, abi: ROUTER_ABI, functionName: "protocolFeePips" }) as Promise<number>,
        client.readContract({ address: cfg.router as `0x${string}`, abi: ROUTER_ABI, functionName: "treasury" }) as Promise<string>,
      ]);
      ok("LP fee", cfg.fee === "8388608" ? `${fmt.badge("dynamic", "green")} verified 0.05%` : "pool fee tier");
      ok("ILAL fee", protocolFeePips > 0 ? `${fmt.badge("protocol", "cyan")} ${pipsToPercent(protocolFeePips)}` : fmt.badge("off", "yellow"));
      ok("treasury", fmt.addr(treasury));
      economicsReady = true;
      pass(true);
    } catch {
      warn("protocol fee", fmt.badge("legacy router", "yellow"));
      economicsReady = true;
      pass(true);
    }
    log.line();
  }

  if (cfg.issuer && isAddress(cfg.issuer)) {
    log.section("Issuer State");
    try {
      const [root, verifier, eas] = await Promise.all([
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "merkleRoot" }) as Promise<bigint>,
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "zkVerifier" }) as Promise<string>,
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "eas" }) as Promise<string>,
      ]);
      const hasEASPath = eas !== ZERO;
      const hasZKPath = root !== 0n && verifier !== ZERO;
      try {
        const meta = await client.readContract({
          address: cfg.issuer as `0x${string}`,
          abi: CNF_ABI,
          functionName: "issuerMetadata",
        }) as readonly [string, string, string, string];
        if (meta[0]) ok("issuer name", meta[0]);
        if (meta[1]) ok("jurisdiction", meta[1]);
        if (meta[2]) ok("standard", meta[2]);
        if (meta[3]) ok("metadata uri", fmt.gray(meta[3]));
      } catch {
        warn("issuer metadata", fmt.badge("legacy issuer", "yellow"));
      }
      if (hasEASPath) ok("issuance path", `${fmt.badge("EAS/mock", "green")} ${fmt.addr(eas)}`);
      else if (hasZKPath) ok("issuance path", fmt.badge("ZK", "green"));
      else warn("issuance path", fmt.badge("not ready", "yellow"));
      issuerPathReady = hasEASPath || hasZKPath;
      if (root === 0n) warn("merkleRoot", fmt.badge("not set", "yellow"));
      else ok("merkleRoot", root.toString().slice(0, 24) + "...");
      if (verifier === ZERO) warn("zkVerifier", fmt.badge("not set", "yellow"));
      else ok("zkVerifier", fmt.addr(verifier));
      pass(issuerPathReady);
    } catch (e) {
      bad("issuer reads", e instanceof Error ? e.message.split("\n")[0]! : String(e));
      pass(false);
    }

    if (wallet && isAddress(wallet)) {
      try {
        const [valid, tokenId] = await Promise.all([
          client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "isValid", args: [wallet as `0x${string}`] }) as Promise<boolean>,
          client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "credentialOf", args: [wallet as `0x${string}`] }) as Promise<bigint>,
        ]);
        if (valid) ok("credential", `${fmt.badge("valid", "green")} token #${tokenId}`);
        else warn("credential", tokenId === 0n ? fmt.badge("missing", "yellow") : fmt.badge("invalid", "yellow"));
        credentialReady = valid;
        pass(valid);
      } catch (e) {
        bad("credential", e instanceof Error ? e.message.split("\n")[0]! : String(e));
        pass(false);
      }
    } else {
      warn("wallet", "pass --wallet or set PRIVATE_KEY for credential checks");
    }
    log.line();
  }

  if (cfg.registry && cfg.poolId && isAddress(cfg.registry) && isHex(cfg.poolId) && cfg.poolId.length === 66) {
    log.section("Pool Policy");
    try {
      const policy = await client.readContract({
        address: cfg.registry as `0x${string}`,
        abi: REGISTRY_ABI,
        functionName: "getPolicy",
        args: [cfg.poolId as `0x${string}`],
      }) as { cnfIssuer: string; requiredCredentialType: string; enabled: boolean };
      const issuerMatches = policy.cnfIssuer.toLowerCase() === (cfg.issuer ?? "").toLowerCase();
      const ready = policy.enabled && issuerMatches;
      (ready ? ok : warn)("policy", `${policy.enabled ? fmt.badge("enabled", "green") : fmt.badge("disabled", "yellow")} issuer ${fmt.addr(policy.cnfIssuer)}`);
      policyReady = ready;
      pass(ready);
    } catch (e) {
      bad("policy", e instanceof Error ? e.message.split("\n")[0]! : String(e));
      pass(false);
    }
    log.line();
  }

  if (wallet && cfg.router && cfg.tokenA && cfg.tokenB && isAddress(wallet) && isAddress(cfg.router)) {
    log.section("Wallet Balances");
    for (const [label, token] of [["currency0", cfg.tokenA], ["currency1", cfg.tokenB]] as const) {
      if (!token || !isAddress(token)) continue;
      try {
        const [symbol, decimals, balance, allowance] = await Promise.all([
          client.readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
          client.readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
          client.readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }) as Promise<bigint>,
          client.readContract({ address: token as `0x${string}`, abi: ERC20_ABI, functionName: "allowance", args: [wallet as `0x${string}`, cfg.router as `0x${string}`] }) as Promise<bigint>,
        ]);
        const balanceText = `${formatUnits(balance, decimals)} ${symbol}`;
        const allowanceText = allowance > 0n ? fmt.badge("approved", "green") : fmt.badge("needs approval", "yellow");
        (balance > 0n ? ok : warn)(label, `${balanceText} ${allowanceText}`);
        walletBalanceChecks.push(balance > 0n);
        pass(balance > 0n);
      } catch (e) {
        bad(label, e instanceof Error ? e.message.split("\n")[0]! : String(e));
        walletBalanceChecks.push(false);
        pass(false);
      }
    }
    walletBalancesReady = walletBalanceChecks.length === 2 && walletBalanceChecks.every(Boolean);
    log.line();
  }

  const infrastructureChecks = [networkReady, configReady, codeReady, economicsReady, issuerPathReady, policyReady];
  const infrastructureReady = infrastructureChecks.every(Boolean);
  const walletSelected = !!wallet && isAddress(wallet);
  const walletReady = walletSelected && credentialReady && walletBalancesReady;
  const realTxReady = infrastructureReady && walletReady;
  const readiness = total === 0 ? 0 : Math.round((score / total) * 100);
  const infraScore = Math.round((infrastructureChecks.filter(Boolean).length / infrastructureChecks.length) * 100);
  const walletScore = walletSelected
    ? Math.round(([credentialReady, walletBalancesReady].filter(Boolean).length / 2) * 100)
    : 0;
  log.section("Readiness");
  const tone = realTxReady ? "green" : infrastructureReady ? "yellow" : readiness >= 60 ? "yellow" : "red";
  log.progress("overall", readiness, tone);
  log.progress("infrastructure", infraScore, infrastructureReady ? "green" : "yellow");
  log.progress("wallet", walletScore, walletReady ? "green" : "yellow");
  log.metrics([
    { label: "infra", value: infrastructureReady ? "ready" : "incomplete", tone: infrastructureReady ? "green" : "yellow" },
    { label: "wallet", value: walletReady ? "ready" : "not ready", tone: walletReady ? "green" : "yellow" },
    { label: "tx", value: realTxReady ? "ready" : "blocked", tone: realTxReady ? "green" : "yellow" },
  ]);
  log.metrics([
    { label: "credential", value: credentialReady ? "valid" : "missing", tone: credentialReady ? "green" : "yellow" },
    { label: "balances", value: walletBalancesReady ? "funded" : "missing", tone: walletBalancesReady ? "green" : "yellow" },
    { label: "policy", value: policyReady ? "enabled" : "missing", tone: policyReady ? "green" : "yellow" },
    { label: "deal", value: cfg.fee === "8388608" ? "better" : "standard", tone: cfg.fee === "8388608" ? "green" : "gray" },
  ]);
  if (realTxReady) {
    log.callout("Live demo ready", "credential, policy, hook, router, pool, and balances are aligned", "green");
  } else if (infrastructureReady) {
    log.callout("Demo infrastructure ready", "wallet is not ready yet: mint CNF and fund demo tokens before real tx", "yellow");
  } else {
    log.callout("Live demo not ready", "fill the missing config/state first", tone);
  }
  log.line();

  log.section("Live Path", realTxReady ? "what the judge is about to see" : "target flow");
  flowStep(
    "credential",
    credentialReady && wallet ? `${fmt.addr(wallet)} holds a valid CNF` : wallet ? `${fmt.addr(wallet)} has no valid CNF` : "wallet not selected",
    credentialReady ? "green" : "yellow"
  );
  flowStep("session", `local EIP-712 binds user + router + pool + action`, "green");
  flowStep("hook", `${cfg.hook ? fmt.addr(cfg.hook) : fmt.badge("missing", "red")} gates swap/liquidity`, cfg.hook ? "green" : "red");
  flowStep("pool", policyReady && cfg.poolId ? `${fmt.hash(cfg.poolId)} policy enabled` : fmt.badge("policy not ready", "yellow"), policyReady ? "green" : "yellow");
  flowStep("balances", walletBalancesReady ? fmt.badge("funded", "green") : fmt.badge("missing demo tokens", "yellow"), walletBalancesReady ? "green" : "yellow");
  flowStep("result", realTxReady ? fmt.badge("ready for real tx", "green") : fmt.badge("wallet not ready for real tx", "yellow"), realTxReady ? "green" : "yellow");
  log.line();

  log.section("Next Commands");
  if (!cfg.router || !cfg.tokenA || !cfg.tokenB || !cfg.poolId) {
    const poolManager = POOL_MANAGER[cfg.chain ?? "84532"] ?? POOL_MANAGER["84532"];
    log.command(`POOL_MANAGER=${poolManager} CNF_ISSUER=${cfg.issuer ?? "<issuer>"} HOOK_ADDR=${cfg.hook ?? "<hook>"} REGISTRY_ADDR=${cfg.registry ?? "<registry>"} forge script contracts/script/DeployDemo.s.sol --rpc-url ${cfg.rpc ?? "https://sepolia.base.org"} --broadcast`);
    log.info("Then copy router/tokenA/tokenB/poolId into .ilal.json");
  }
  if (wallet) {
    log.command(`ilal status --wallet ${wallet}`);
    if (!credentialReady) {
      log.info("Credential missing: the issuer must create an attestation before the wallet can mint CNF.");
      log.command(`PRIVATE_KEY=<issuer-key> ilal issuer attest --wallet ${wallet}`);
      log.command("PRIVATE_KEY=<wallet-key> ilal credential mint --attestation <uid>");
    }
    log.command(`ilal session sign --pool ${cfg.poolId ?? "<poolId>"} --action swap --hook ${cfg.hook ?? "<hook>"} --issuer ${cfg.issuer ?? "<issuer>"} --caller ${cfg.router ?? "<router>"}`);
  } else {
    log.command("ilal demo check --wallet <wallet>");
  }
  const suggestedTokenIn = cfg.tokenB ?? "<token>";
  log.command(`ilal swap --amount-in 0.001 --token-in ${suggestedTokenIn}`);
  console.log();
}

export async function demoFaucet(opts: { wallet?: string; amount?: string; privateKey?: string }) {
  const cfg = loadConfig();
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const rawKey = requirePrivateKey(opts.privateKey ?? process.env["PRIVATE_KEY"]);
  if (!cfg.tokenA || !cfg.tokenB || !isAddress(cfg.tokenA) || !isAddress(cfg.tokenB)) {
    die("tokenA/tokenB required. Run `ilal init` with demo token addresses first.");
  }

  const account = privateKeyToAccount(rawKey);
  const wallet = opts.wallet ?? account.address;
  if (!isAddress(wallet)) die(`Invalid wallet address: ${wallet}`);

  const client = createPublicClient({ chain, transport: http(cfg.rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpc) });

  header("ILAL Demo Faucet", chain.name);
  log.kv("recipient", fmt.addr(wallet));
  log.line();

  for (const token of [cfg.tokenA, cfg.tokenB] as `0x${string}`[]) {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
      client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    ]);
    const amount = parseUnits(opts.amount ?? "10000", decimals);
    const spin = new Spinner(`Minting ${opts.amount ?? "10000"} ${symbol}…`).start();
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "mint",
      args: [wallet as `0x${string}`, amount],
    });
    await client.waitForTransactionReceipt({ hash });
    spin.succeed(`Minted ${symbol} ${fmt.hash(hash)}`);
  }

  log.callout("Demo tokens ready", "wallet can now pass token-balance preflight checks", "green");
  console.log();
}

export async function demoAttest(opts: { wallet: string; privateKey?: string; expiresInDays?: string }) {
  const cfg = loadConfig();
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const rawKey = requirePrivateKey(opts.privateKey ?? process.env["PRIVATE_KEY"]);
  if (!cfg.issuer || !isAddress(cfg.issuer)) die("CNFIssuer required. Run `ilal init` first.");
  if (!isAddress(opts.wallet)) die(`Invalid wallet address: ${opts.wallet}`);

  const account = privateKeyToAccount(rawKey);
  const client = createPublicClient({ chain, transport: http(cfg.rpc) });
  const walletClient = createWalletClient({ account, chain, transport: http(cfg.rpc) });

  const [eas, schemaUID, trustedAttester] = await Promise.all([
    client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "eas" }) as Promise<string>,
    client.readContract({ address: cfg.issuer as `0x${string}`, abi: [
      { name: "schemaUID", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "bytes32" as const }] },
    ], functionName: "schemaUID" }) as Promise<string>,
    client.readContract({ address: cfg.issuer as `0x${string}`, abi: [
      { name: "trustedAttester", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
    ], functionName: "trustedAttester" }) as Promise<string>,
  ]);

  if (eas === ZERO) die("Configured issuer has no EAS path. Use an issuer with EAS configured or mint through ZK proof.");

  const days = BigInt(parseInt(opts.expiresInDays ?? "90", 10));
  const expiration = BigInt(Math.floor(Date.now() / 1000)) + days * 24n * 60n * 60n;

  header("ILAL Demo Attestation", chain.name);
  log.kv("mockEAS", fmt.addr(eas));
  log.kv("issuer", fmt.addr(cfg.issuer));
  log.kv("recipient", fmt.addr(opts.wallet));
  log.kv("attester", fmt.addr(trustedAttester));
  log.line();

  const spin = new Spinner("Creating MockEAS attestation…").start();
  const hash = await walletClient.writeContract({
    address: eas as `0x${string}`,
    abi: MOCK_EAS_ABI,
    functionName: "attest",
    args: [
      schemaUID as `0x${string}`,
      opts.wallet as `0x${string}`,
      trustedAttester as `0x${string}`,
      expiration,
      "0x",
    ],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  spin.succeed(`Attestation created ${fmt.gray(fmt.hash(hash))}`);

  let uid: string | undefined;
  for (const logItem of receipt.logs) {
    if (logItem.address.toLowerCase() !== eas.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: MOCK_EAS_ABI, data: logItem.data, topics: logItem.topics });
      if (decoded.eventName === "AttestationCreated") {
        uid = decoded.args.uid;
        break;
      }
    } catch {}
  }

  log.line();
  if (uid) log.kv("attestation", fmt.cyan(uid));
  log.kv("tx", fmt.gray(hash));
  log.callout("CNF mint path ready", "the recipient wallet can now run `ilal credential mint --attestation <uid>`", "green");
  if (uid) {
    console.log();
    log.command(`PRIVATE_KEY=0x... ilal credential mint --issuer ${cfg.issuer} --attestation ${uid} --chain ${chain.id}`);
  }
  console.log();
}
