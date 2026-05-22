import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, die } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

const REGISTRY_ABI = [
  {
    name: "setPolicy",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "poolId", type: "bytes32" as const },
      { name: "cnfIssuer", type: "address" as const },
      { name: "credentialType", type: "bytes32" as const },
    ],
    outputs: [],
  },
  {
    name: "disablePolicy",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "poolId", type: "bytes32" as const }],
    outputs: [],
  },
  {
    name: "getPolicy",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "poolId", type: "bytes32" as const }],
    outputs: [{
      type: "tuple" as const,
      components: [
        { name: "cnfIssuer", type: "address" as const },
        { name: "requiredCredentialType", type: "bytes32" as const },
        { name: "enabled", type: "bool" as const },
      ],
    }],
  },
] as const;

export async function poolPolicySet(opts: {
  pool: string;
  issuer: string;
  credType: string;
  registry: string;
  chain: string;
  rpc?: string;
  privateKey?: string;
}) {
  const rawKey = opts.privateKey ?? process.env["PRIVATE_KEY"];
  if (!rawKey) die("Private key required. Use --private-key or set PRIVATE_KEY env var.");
  if (!isHex(rawKey) || rawKey.length !== 66) die("Invalid private key.");
  if (!isAddress(opts.issuer)) die(`Invalid issuer address: ${opts.issuer}`);
  if (!isAddress(opts.registry)) die(`Invalid registry address: ${opts.registry}`);
  if (!isHex(opts.pool) || opts.pool.length !== 66) die("poolId must be 0x + 32 bytes.");
  if (!isHex(opts.credType) || opts.credType.length !== 66) die("credType must be 0x + 32 bytes.");

  const chain = CHAINS[opts.chain] ?? baseSepolia;
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const transport = opts.rpc ? http(opts.rpc) : http();
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  header("Pool Policy Set", chain.name);
  log.section("Request");
  log.kv("operator", fmt.addr(account.address));
  log.kv("registry", fmt.addr(opts.registry));
  log.kv("pool", fmt.hash(opts.pool));
  log.kv("issuer", fmt.addr(opts.issuer));
  log.kv("credType", fmt.hash(opts.credType));
  log.line();

  const spin = new Spinner("Sending setPolicy transaction…").start();

  const hash = await walletClient.writeContract({
    address: opts.registry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "setPolicy",
    args: [opts.pool as `0x${string}`, opts.issuer as `0x${string}`, opts.credType as `0x${string}`],
  });

  spin.update(`Confirming ${fmt.hash(hash)}…`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") die(`Transaction reverted. Hash: ${hash}`);
  spin.succeed("Transaction confirmed");

  const policy = await publicClient.readContract({
    address: opts.registry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "getPolicy",
    args: [opts.pool as `0x${string}`],
  }) as { cnfIssuer: string; requiredCredentialType: string; enabled: boolean };

  log.section("Registered Policy");
  log.kv("cnfIssuer", fmt.addr(policy.cnfIssuer));
  log.kv("credType", fmt.hash(policy.requiredCredentialType));
  log.kv("enabled", policy.enabled ? fmt.badge("true", "green") : fmt.badge("false", "red"));
  log.kv("tx", fmt.hash(hash));
  log.result("Policy registered", "", "green");
  console.log();
}

export async function poolPolicyGet(opts: {
  pool: string;
  registry: string;
  chain: string;
  rpc?: string;
}) {
  if (!isAddress(opts.registry)) die(`Invalid registry address: ${opts.registry}`);
  if (!isHex(opts.pool) || opts.pool.length !== 66) die("poolId must be 0x + 32 bytes.");

  const chain = CHAINS[opts.chain] ?? baseSepolia;
  const transport = opts.rpc ? http(opts.rpc) : http();
  const publicClient = createPublicClient({ chain, transport });

  header("Pool Policy", chain.name);

  const policy = await publicClient.readContract({
    address: opts.registry as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "getPolicy",
    args: [opts.pool as `0x${string}`],
  }) as { cnfIssuer: string; requiredCredentialType: string; enabled: boolean };

  log.section("Policy");
  log.kv("pool", fmt.hash(opts.pool));
  log.kv("registry", fmt.addr(opts.registry));
  log.kv("cnfIssuer", policy.cnfIssuer === "0x0000000000000000000000000000000000000000" ? fmt.badge("unset", "red") : fmt.addr(policy.cnfIssuer));
  log.kv("credType", fmt.hash(policy.requiredCredentialType));
  log.kv("enabled", policy.enabled ? fmt.badge("true", "green") : fmt.badge("false", "red"));
  console.log();
}
