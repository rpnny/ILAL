import {
  createPublicClient,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { withConfig } from "../config.js";
import { fmt, header, log, die, Spinner } from "../ui.js";
import { loadSnarkjsProof } from "./proof.js";
import { createExecutionClients } from "../signer.js";
import { proposeConfiguredSafeContractCall } from "../safe.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

export const POLICY_REGISTRY_V2_ABI = [
  {
    name: "setEligibilityPolicy",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "poolId", type: "bytes32" as const },
      { name: "issuerHash", type: "uint256" as const },
      { name: "schemaHash", type: "uint256" as const },
      { name: "credentialRoot", type: "uint256" as const },
      { name: "minKycLevel", type: "uint8" as const },
      { name: "jurisdictionRoot", type: "uint256" as const },
      { name: "policyHash", type: "uint256" as const },
      { name: "maxGrantTTL", type: "uint64" as const },
    ],
    outputs: [],
  },
  {
    name: "disableEligibilityPolicy",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "poolId", type: "bytes32" as const }],
    outputs: [],
  },
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
    name: "revokePolicyGrant",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "poolId", type: "bytes32" as const },
      { name: "user", type: "address" as const },
    ],
    outputs: [],
  },
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

const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

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
}, requireGrantManager = true) {
  const cfg = withConfig({
    poolId: opts.pool,
    registry: opts.registry,
    grantManager: opts.grantManager,
    chain: opts.chain,
    rpc: opts.rpc,
  });
  if (!cfg.poolId || !isHex(cfg.poolId) || cfg.poolId.length !== 66) die("A valid pool ID is required");
  if (!cfg.registry || !isAddress(cfg.registry)) die("EligibilityPolicyRegistryV2 address required");
  if (requireGrantManager && (!cfg.grantManager || !isAddress(cfg.grantManager))) {
    die("PolicyGrantManagerV2 address required");
  }
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  return { cfg, chain, transport: cfg.rpc ? http(cfg.rpc) : http() };
}

function fieldElement(value: string, name: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    die(`${name} must be a decimal or 0x-prefixed uint256 value`);
  }
  if (parsed <= 0n || parsed >= SNARK_SCALAR_FIELD) {
    die(`${name} must be a nonzero BN254 scalar-field element`);
  }
  return parsed;
}

function positiveInteger(value: string, name: string, max: bigint): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    die(`${name} must be an integer`);
  }
  if (parsed <= 0n || parsed > max) die(`${name} must be between 1 and ${max.toString()}`);
  return parsed;
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

export async function waitForPolicyGrant(
  readGrantValidity: () => Promise<boolean>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<boolean> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 750;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await readGrantValidity()) return true;
    if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  return false;
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

  const valid = await waitForPolicyGrant(async () => publicClient.readContract({
    address: cfg.grantManager as `0x${string}`,
    abi: GRANT_MANAGER_V2_ABI,
    functionName: "isPolicyGrantValid",
    args: [poolId, account.address],
  }) as Promise<boolean>);
  if (!valid) die("Policy grant activation mined, but current state is not visible after 5 bounded checks; retry `ilal policy grant status` after the RPC catches up");
  log.ok("Policy grant activated");
  log.kv("tx", hash);
  log.kv("block", receipt.blockNumber.toString());
  log.line();
}

export async function policySetV2(opts: {
  pool?: string;
  registry?: string;
  chain?: string;
  rpc?: string;
  issuerHash: string;
  schemaHash: string;
  credentialRoot: string;
  minKycLevel: string;
  jurisdictionRoot: string;
  policyHash: string;
  maxGrantTtl: string;
  privateKey?: string;
}) {
  const { cfg, chain } = resolveV2(opts, false);
  const poolId = cfg.poolId as `0x${string}`;
  const values = {
    issuerHash: fieldElement(opts.issuerHash, "--issuer-hash"),
    schemaHash: fieldElement(opts.schemaHash, "--schema-hash"),
    credentialRoot: fieldElement(opts.credentialRoot, "--credential-root"),
    jurisdictionRoot: fieldElement(opts.jurisdictionRoot, "--jurisdiction-root"),
    policyHash: fieldElement(opts.policyHash, "--policy-hash"),
    minKycLevel: positiveInteger(opts.minKycLevel, "--min-kyc-level", 3n),
    maxGrantTtl: positiveInteger(opts.maxGrantTtl, "--max-grant-ttl", 7n * 24n * 60n * 60n),
  };
  const args = [
    poolId,
    values.issuerHash,
    values.schemaHash,
    values.credentialRoot,
    Number(values.minKycLevel),
    values.jurisdictionRoot,
    values.policyHash,
    values.maxGrantTtl,
  ] as const;
  if (await proposeConfiguredSafeContractCall({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    address: cfg.registry as `0x${string}`,
    abi: POLICY_REGISTRY_V2_ABI,
    functionName: "setEligibilityPolicy",
    args,
  })) return;

  const { account, publicClient, walletClient } = await createExecutionClients({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    legacyPrivateKey: opts.privateKey,
  });
  header("Set Eligibility Policy", chain.name);
  log.kv("operator", fmt.addr(account.address));
  log.kv("registry", fmt.addr(cfg.registry!));
  log.kv("pool", fmt.hash(poolId));
  log.kv("policy hash", values.policyHash.toString());
  log.kv("minimum KYC", values.minKycLevel.toString());
  log.kv("max grant TTL", `${values.maxGrantTtl.toString()}s`);
  log.line();
  const spin = new Spinner("Setting the v2 eligibility policy...").start();
  const hash = await walletClient.writeContract({
    account,
    address: cfg.registry as `0x${string}`,
    abi: POLICY_REGISTRY_V2_ABI,
    functionName: "setEligibilityPolicy",
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Eligibility policy transaction reverted: ${hash}`);
  spin.succeed(`Policy confirmed in block ${receipt.blockNumber.toString()}`);
  const policy = await readEligibilityPolicyV2(publicClient, cfg.registry as `0x${string}`, poolId);
  log.kv("revision", policy.revision.toString());
  log.kv("tx", hash);
  log.line();
}

export async function policyDisableV2(opts: {
  pool?: string;
  registry?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const { cfg, chain } = resolveV2(opts, false);
  const poolId = cfg.poolId as `0x${string}`;
  if (await proposeConfiguredSafeContractCall({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    address: cfg.registry as `0x${string}`,
    abi: POLICY_REGISTRY_V2_ABI,
    functionName: "disableEligibilityPolicy",
    args: [poolId],
  })) return;
  const { account, publicClient, walletClient } = await createExecutionClients({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    legacyPrivateKey: opts.privateKey,
  });
  header("Disable Eligibility Policy", chain.name);
  log.kv("operator", fmt.addr(account.address));
  log.kv("pool", fmt.hash(poolId));
  const spin = new Spinner("Disabling policy and invalidating current grants...").start();
  const hash = await walletClient.writeContract({
    account,
    address: cfg.registry as `0x${string}`,
    abi: POLICY_REGISTRY_V2_ABI,
    functionName: "disableEligibilityPolicy",
    args: [poolId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Policy disable transaction reverted: ${hash}`);
  spin.succeed(`Policy disabled in block ${receipt.blockNumber.toString()}`);
  log.kv("tx", hash);
  log.line();
}

export async function policyGrantRevoke(opts: {
  wallet: string;
  pool?: string;
  registry?: string;
  grantManager?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const { cfg, chain } = resolveV2(opts);
  if (!isAddress(opts.wallet)) die("A valid --wallet address is required");
  const poolId = cfg.poolId as `0x${string}`;
  const wallet = opts.wallet as `0x${string}`;
  if (await proposeConfiguredSafeContractCall({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    address: cfg.grantManager as `0x${string}`,
    abi: GRANT_MANAGER_V2_ABI,
    functionName: "revokePolicyGrant",
    args: [poolId, wallet],
  })) return;
  const { account, publicClient, walletClient } = await createExecutionClients({
    chain,
    rpc: opts.rpc ?? cfg.rpc,
    legacyPrivateKey: opts.privateKey,
  });
  header("Revoke Policy Grant", chain.name);
  log.kv("operator", fmt.addr(account.address));
  log.kv("wallet", fmt.addr(wallet));
  log.kv("pool", fmt.hash(poolId));
  const spin = new Spinner("Revoking the wallet grant for the current policy revision...").start();
  const hash = await walletClient.writeContract({
    account,
    address: cfg.grantManager as `0x${string}`,
    abi: GRANT_MANAGER_V2_ABI,
    functionName: "revokePolicyGrant",
    args: [poolId, wallet],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Grant revocation reverted: ${hash}`);
  spin.succeed(`Grant revoked in block ${receipt.blockNumber.toString()}`);
  log.kv("tx", hash);
  log.line();
}

export async function policyProofGenerate(opts: {
  input: string;
  circuitDir?: string;
  wasm?: string;
  zkey?: string;
  vkey?: string;
  outDir?: string;
}) {
  const cfg = withConfig(opts);
  const circuitDir = resolve(opts.circuitDir ?? cfg.circuitDir ?? "circuits/build-v2");
  const inputPath = resolve(opts.input);
  const wasmPath = resolve(opts.wasm ?? circuitDir, opts.wasm ? "" : "ilal_policy_js/ilal_policy.wasm");
  const zkeyPath = resolve(opts.zkey ?? circuitDir, opts.zkey ? "" : "ilal_policy_v2.zkey");
  const vkeyPath = resolve(opts.vkey ?? circuitDir, opts.vkey ? "" : "ilal_policy_v2_vkey.json");
  for (const [label, path] of [["input", inputPath], ["WASM", wasmPath], ["zkey", zkeyPath], ["verification key", vkeyPath]] as const) {
    if (!existsSync(path)) die(`Missing ${label}: ${path}`);
  }
  let input: Record<string, unknown>;
  let verificationKey: Record<string, unknown>;
  try {
    input = JSON.parse(readFileSync(inputPath, "utf8")) as Record<string, unknown>;
    verificationKey = JSON.parse(readFileSync(vkeyPath, "utf8")) as Record<string, unknown>;
  } catch (error) {
    die(`Invalid proof input or verification-key JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const outputDir = resolve(opts.outDir ?? cfg.outDir ?? "artifacts/v2-proof");
  mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  header("Generate V2 Policy Proof", "local only");
  log.kv("input", inputPath);
  log.kv("artifacts", circuitDir);
  log.kv("output", outputDir);
  log.info("Private witness attributes stay in the input file and are not copied or uploaded.");
  const spin = new Spinner("Generating Groth16 proof...").start();
  const snarkjs = await import("snarkjs") as unknown as {
    groth16: {
      fullProve(input: Record<string, unknown>, wasm: string, zkey: string): Promise<{ proof: unknown; publicSignals: string[] }>;
      verify(vkey: Record<string, unknown>, publicSignals: string[], proof: unknown): Promise<boolean>;
    };
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
  if (publicSignals.length !== 9 || BigInt(publicSignals[8] ?? "0") !== 2n) {
    spin.fail("Unexpected circuit public-input shape");
    die(`Expected 9 public inputs ending in circuitVersion=2; received ${publicSignals.length}`);
  }
  if (!await snarkjs.groth16.verify(verificationKey, publicSignals, proof)) {
    spin.fail("Local proof verification failed");
    die("Generated proof did not verify against the selected verification key");
  }
  const proofPath = resolve(outputDir, "proof.json");
  const publicPath = resolve(outputDir, "public.json");
  writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(publicPath, `${JSON.stringify(publicSignals, null, 2)}\n`, { mode: 0o600 });
  chmodSync(proofPath, 0o600);
  chmodSync(publicPath, 0o600);
  spin.succeed("Proof generated and verified locally");
  log.kv("proof", proofPath);
  log.kv("public", publicPath);
  log.kv("wallet hash", publicSignals[0]!);
  log.kv("policy hash", publicSignals[7]!);
  log.callout("Grant input ready", "Run `ilal policy grant activate --proof <proof> --public <public>` as the bound wallet", "green");
  log.line();
}
