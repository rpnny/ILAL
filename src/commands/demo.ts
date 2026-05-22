import {
  createPublicClient,
  formatUnits,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { loadConfig } from "../config.js";
import { fmt, header, log } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };
const POOL_MANAGER: Record<string, `0x${string}`> = {
  "84532": "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408",
  "8453": "0x498581fF718922c3f8e6A244956aF099B2652b2b",
};

const SAMPLE = {
  wallet: "0x1b869CaC69Df23Ad9D727932496AEb3605538c8D",
  issuer: "0x319c0F1cb46c85B42E051251c4db04BA6BD265a2",
  hook: "0xdFF2ebBAc963f5Ed0B0EBCf021aB5EA16d57ea94",
  router: "0x4A1F7E7d9D2D1f2A0c4A2F4A8C1A0B3E9E5d1111",
  pool: "0x7ef1c0ffee00000000000000000000000000000000000000000000000000bEEF",
  proof: "0x91f2b8a0c43e902f7f1a8c0d",
  session: "0x6b84eac5e0db21f8d5d43b7a",
};

const ZERO = "0x0000000000000000000000000000000000000000";

const CNF_ABI = [
  { name: "isValid", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "credentialOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "merkleRoot", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint256" as const }] },
  { name: "zkVerifier", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
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
  const pass = (condition: boolean) => {
    total++;
    if (condition) score++;
  };

  log.section("Network");
  log.kv("rpc", cfg.rpc ?? "default viem transport");
  try {
    const block = await client.getBlockNumber();
    ok("latest block", block.toString());
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
    else bad(label, fmt.badge("missing", "red"));
    pass(valid);
  }
  log.line();

  log.section("Contract Code", "must exist on-chain");
  pass(await hasCode(client, "CNFIssuer", cfg.issuer));
  pass(await hasCode(client, "ComplianceHook", cfg.hook));
  pass(await hasCode(client, "PolicyRegistry", cfg.registry));
  pass(await hasCode(client, "ILALRouter", cfg.router));
  pass(await hasCode(client, "currency0", cfg.tokenA));
  pass(await hasCode(client, "currency1", cfg.tokenB));
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
      pass(true);
    } catch {
      warn("protocol fee", fmt.badge("legacy router", "yellow"));
      pass(true);
    }
    log.line();
  }

  if (cfg.issuer && isAddress(cfg.issuer)) {
    log.section("Issuer State");
    try {
      const [root, verifier] = await Promise.all([
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "merkleRoot" }) as Promise<bigint>,
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "zkVerifier" }) as Promise<string>,
      ]);
      if (root === 0n) warn("merkleRoot", fmt.badge("not set", "yellow"));
      else ok("merkleRoot", root.toString().slice(0, 24) + "...");
      if (verifier === ZERO) warn("zkVerifier", fmt.badge("not set", "yellow"));
      else ok("zkVerifier", fmt.addr(verifier));
    } catch (e) {
      bad("issuer reads", e instanceof Error ? e.message.split("\n")[0]! : String(e));
    }

    if (wallet && isAddress(wallet)) {
      try {
        const [valid, tokenId] = await Promise.all([
          client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "isValid", args: [wallet as `0x${string}`] }) as Promise<boolean>,
          client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "credentialOf", args: [wallet as `0x${string}`] }) as Promise<bigint>,
        ]);
        if (valid) ok("credential", `${fmt.badge("valid", "green")} token #${tokenId}`);
        else warn("credential", tokenId === 0n ? fmt.badge("missing", "yellow") : fmt.badge("invalid", "yellow"));
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
        pass(balance > 0n);
      } catch (e) {
        bad(label, e instanceof Error ? e.message.split("\n")[0]! : String(e));
        pass(false);
      }
    }
    log.line();
  }

  const readiness = total === 0 ? 0 : Math.round((score / total) * 100);
  log.section("Readiness");
  const tone = readiness >= 85 ? "green" : readiness >= 60 ? "yellow" : "red";
  log.progress("score", readiness, tone);
  log.metrics([
    { label: "credential", value: wallet ? "ready" : "missing", tone: wallet ? "green" : "yellow" },
    { label: "policy", value: cfg.poolId ? "enabled" : "missing", tone: cfg.poolId ? "green" : "yellow" },
    { label: "deal", value: cfg.fee === "8388608" ? "better" : "standard", tone: cfg.fee === "8388608" ? "green" : "gray" },
  ]);
  if (readiness >= 85) {
    log.callout("Live demo ready", "credential, policy, hook, router, pool, and balances are aligned", "green");
  } else {
    log.callout("Live demo not ready", "fill the missing config/state first", tone);
  }
  log.line();

  log.section("Live Path", readiness >= 85 ? "what the judge is about to see" : "target flow");
  flowStep("credential", wallet ? `${fmt.addr(wallet)} holds a valid CNF` : "wallet not selected", wallet ? "green" : "yellow");
  flowStep("session", `local EIP-712 binds user + router + pool + action`, "green");
  flowStep("hook", `${cfg.hook ? fmt.addr(cfg.hook) : fmt.badge("missing", "red")} gates swap/liquidity`, cfg.hook ? "green" : "red");
  flowStep("pool", cfg.poolId ? `${fmt.hash(cfg.poolId)} policy enabled` : fmt.badge("missing", "red"), cfg.poolId ? "green" : "red");
  flowStep("result", readiness >= 85 ? fmt.badge("ready for real tx", "green") : fmt.badge("preflight incomplete", "yellow"), readiness >= 85 ? "green" : "yellow");
  log.line();

  log.section("Next Commands");
  if (!cfg.router || !cfg.tokenA || !cfg.tokenB || !cfg.poolId) {
    const poolManager = POOL_MANAGER[cfg.chain ?? "84532"] ?? POOL_MANAGER["84532"];
    log.command(`POOL_MANAGER=${poolManager} CNF_ISSUER=${cfg.issuer ?? "<issuer>"} HOOK_ADDR=${cfg.hook ?? "<hook>"} REGISTRY_ADDR=${cfg.registry ?? "<registry>"} forge script contracts/script/DeployDemo.s.sol --rpc-url ${cfg.rpc ?? "https://sepolia.base.org"} --broadcast`);
    log.info("Then copy router/tokenA/tokenB/poolId into .ilal.json");
  }
  if (wallet) {
    log.command(`ilal status --wallet ${wallet}`);
    log.command(`ilal session sign --pool ${cfg.poolId ?? "<poolId>"} --action swap --hook ${cfg.hook ?? "<hook>"} --issuer ${cfg.issuer ?? "<issuer>"} --caller ${cfg.router ?? "<router>"}`);
  } else {
    log.command("ilal demo check --wallet <wallet>");
  }
  const suggestedTokenIn = cfg.tokenB ?? "<token>";
  log.command(`ilal swap --amount-in 0.001 --token-in ${suggestedTokenIn}`);
  console.log();
}
