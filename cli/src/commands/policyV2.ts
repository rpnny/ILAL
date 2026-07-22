import {
  createPublicClient,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { withConfig } from "../config.js";
import { fmt, header, log, die } from "../ui.js";
import { loadSnarkjsProof } from "./proof.js";
import { createExecutionClients } from "../signer.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

export const POLICY_REGISTRY_V2_ABI = [
  {
    name: "getEligibilityPolicy",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "poolId", type: "bytes32" as const }],
    outputs: [{
      name: "policy",
      type: "tuple" as const,
      components: [
        { name: "issuerHash", type: "uint256" as const },
        { name: "schemaHash", type: "uint256" as const },
        { name: "credentialRoot", type: "uint256" as const },
        { name: "jurisdictionRoot", type: "uint256" as const },
        { name: "policyHash", type: "uint256" as const },
        { name: "maxGrantTTL", type: "uint64" as const },
        { name: "revision", type: "uint64" as const },
        { name: "minKycLevel", type: "uint8" as const },
        { name: "enabled", type: "bool" as const },
      ],
    }],
  },
] as const;

const GRANT_MANAGER_V2_ABI = [
  {
    name: "activatePolicyGrant",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "poolId", type: "bytes32" as const },
      { name: "proof", type: "bytes" as const },
      { name: "publicInputs", type: "uint256[]" as const },
    ],
    outputs: [{ name: "grantExpiresAt", type: "uint64" as const }],
  },
  {
    name: "isPolicyGrantValid",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [
      { name: "poolId", type: "bytes32" as const },
      { name: "user", type: "address" as const },
    ],
    outputs: [{ type: "bool" as const }],
  },
  {
    name: "grants",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [
      { name: "poolId", type: "bytes32" as const },
      { name: "user", type: "address" as const },
    ],
    outputs: [
      { name: "policyHash", type: "uint256" as const },
      { name: "expiresAt", type: "uint64" as const },
      { name: "policyRevision", type: "uint64" as const },
    ],
  },
] as const;

export type EligibilityPolicyV2 = {
  issuerHash: bigint;
  schemaHash: bigint;
  credentialRoot: bigint;
  jurisdictionRoot: bigint;
  policyHash: bigint;
  maxGrantTTL: bigint;
  revision: bigint;
  minKycLevel: number;
  enabled: boolean;
};

function resolveV2(opts: {
  pool?: string;
  registry?: string;
  grantManager?: string;
  chain?: string;
  rpc?: string;
}) {
  const cfg = withConfig({
    poolId: opts.pool,
    registry: opts.registry,
    grantManager: opts.grantManager,
    chain: opts.chain,
    rpc: opts.rpc,
  });
  if (!cfg.poolId || !isHex(cfg.poolId) || cfg.poolId.length !== 66) die("A valid pool ID is required");
  if (!cfg.registry || !isAddress(cfg.registry)) die("EligibilityPolicyRegistryV2 address required");
  if (!cfg.grantManager || !isAddress(cfg.grantManager)) die("PolicyGrantManagerV2 address required");
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  return { cfg, chain, transport: cfg.rpc ? http(cfg.rpc) : http() };
}

export async function readEligibilityPolicyV2(
  publicClient: ReturnType<typeof createPublicClient>,
  registry: `0x${string}`,
  poolId: `0x${string}`
): Promise<EligibilityPolicyV2> {
  return await publicClient.readContract({
    address: registry,
    abi: POLICY_REGISTRY_V2_ABI,
    functionName: "getEligibilityPolicy",
    args: [poolId],
  }) as EligibilityPolicyV2;
}

export async function policyGrantStatus(opts: {
  wallet?: string;
  pool?: string;
  registry?: string;
  grantManager?: string;
  chain?: string;
  rpc?: string;
}) {
  const { cfg, chain, transport } = resolveV2(opts);
  if (!opts.wallet || !isAddress(opts.wallet)) die("A valid --wallet address is required");
  const publicClient = createPublicClient({ chain, transport });
  const poolId = cfg.poolId as `0x${string}`;
  const wallet = opts.wallet as `0x${string}`;
  const [policy, valid, grant] = await Promise.all([
    readEligibilityPolicyV2(publicClient, cfg.registry as `0x${string}`, poolId),
    publicClient.readContract({
      address: cfg.grantManager as `0x${string}`,
      abi: GRANT_MANAGER_V2_ABI,
      functionName: "isPolicyGrantValid",
      args: [poolId, wallet],
    }) as Promise<boolean>,
    publicClient.readContract({
      address: cfg.grantManager as `0x${string}`,
      abi: GRANT_MANAGER_V2_ABI,
      functionName: "grants",
      args: [poolId, wallet],
    }) as Promise<readonly [bigint, bigint, bigint]>,
  ]);

  header("Policy Grant", chain.name);
  log.kv("wallet", fmt.addr(wallet));
  log.kv("pool", fmt.hash(poolId));
  log.section("Current Policy");
  log.kv("enabled", policy.enabled ? fmt.green("true") : fmt.red("false"));
  log.kv("policy hash", policy.policyHash.toString());
  log.kv("revision", policy.revision.toString());
  log.kv("minimum KYC", policy.minKycLevel.toString());
  log.kv("max grant TTL", `${policy.maxGrantTTL.toString()}s`);
  log.section("Wallet Grant");
  log.kv("valid", valid ? fmt.green("true") : fmt.red("false"));
  log.kv("policy hash", grant[0].toString());
  log.kv("revision", grant[2].toString());
  log.kv("expires", grant[1] === 0n ? "not activated" : new Date(Number(grant[1]) * 1000).toISOString());
  log.line();
}

export async function policyGrantActivate(opts: {
  proof: string;
  public: string;
  pool?: string;
  registry?: string;
  grantManager?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const { cfg, chain } = resolveV2(opts);
  const { account, publicClient, walletClient } = await createExecutionClients({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    legacyPrivateKey: opts.privateKey,
  });
  const poolId = cfg.poolId as `0x${string}`;
  const { proofBytes, publicInputs } = loadSnarkjsProof(opts.proof, opts.public);
  if (publicInputs.length !== 9) die(`Circuit v2 requires exactly 9 public inputs; received ${publicInputs.length}`);

  const policy = await readEligibilityPolicyV2(
    publicClient,
    cfg.registry as `0x${string}`,
    poolId
  );
  if (!policy.enabled || policy.revision === 0n) die("The pool eligibility policy is not enabled");
  if (publicInputs[7] !== policy.policyHash) die("Proof policyHash does not match the current pool policy");
  if (publicInputs[8] !== 2n) die("Proof circuitVersion is not 2");

  header("Activate Policy Grant", chain.name);
  log.kv("wallet", fmt.addr(account.address));
  log.kv("pool", fmt.hash(poolId));
  log.kv("policy", `${policy.policyHash.toString()} (revision ${policy.revision.toString()})`);
  log.step("Submitting the v2 eligibility proof on-chain…");
  const hash = await walletClient.writeContract({
    address: cfg.grantManager as `0x${string}`,
    abi: GRANT_MANAGER_V2_ABI,
    functionName: "activatePolicyGrant",
    args: [poolId, proofBytes, publicInputs],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Policy grant activation reverted: ${hash}`);

  const valid = await publicClient.readContract({
    address: cfg.grantManager as `0x${string}`,
    abi: GRANT_MANAGER_V2_ABI,
    functionName: "isPolicyGrantValid",
    args: [poolId, account.address],
  });
  if (!valid) die("Transaction confirmed, but the policy grant is not valid");
  log.ok("Policy grant activated");
  log.kv("tx", hash);
  log.kv("block", receipt.blockNumber.toString());
  log.line();
}
