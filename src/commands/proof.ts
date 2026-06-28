import { readFileSync } from "fs";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  isAddress,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, die, requirePrivateKey } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

// snarkjs proof.json shape
interface SnarkjsProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
  protocol: string;
  curve: string;
}

const CNF_ISSUER_ABI = [
  {
    name: "mintWithProof",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "proof", type: "bytes" as const },
      { name: "publicInputs", type: "uint256[]" as const },
    ],
    outputs: [{ name: "tokenId", type: "uint256" as const }],
  },
  {
    name: "renewWithProof",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "proof", type: "bytes" as const },
      { name: "publicInputs", type: "uint256[]" as const },
    ],
    outputs: [],
  },
  {
    name: "isValid",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "wallet", type: "address" as const }],
    outputs: [{ type: "bool" as const }],
  },
] as const;

function loadSnarkjsProof(proofPath: string, publicPath: string): {
  proofBytes: `0x${string}`;
  publicInputs: bigint[];
} {
  let rawProof: SnarkjsProof;
  let rawPublic: string[];

  try {
    rawProof = JSON.parse(readFileSync(proofPath, "utf8")) as SnarkjsProof;
  } catch {
    die(`Cannot read proof file: ${proofPath}`);
  }
  try {
    rawPublic = JSON.parse(readFileSync(publicPath, "utf8")) as string[];
  } catch {
    die(`Cannot read public inputs file: ${publicPath}`);
  }

  if (rawProof!.protocol !== "groth16") {
    log.warn(`Unexpected proof protocol: ${rawProof!.protocol} (expected groth16)`);
  }

  // snarkjs bn128 proofs store G2 points in reversed coordinate order
  const a: [bigint, bigint] = [BigInt(rawProof!.pi_a[0]), BigInt(rawProof!.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(rawProof!.pi_b[0][1]), BigInt(rawProof!.pi_b[0][0])],
    [BigInt(rawProof!.pi_b[1][1]), BigInt(rawProof!.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [BigInt(rawProof!.pi_c[0]), BigInt(rawProof!.pi_c[1])];

  const proofBytes = encodeAbiParameters(
    [
      { type: "uint256[2]" },
      { type: "uint256[2][2]" },
      { type: "uint256[2]" },
    ],
    [a, b, c]
  ) as `0x${string}`;

  const publicInputs = rawPublic!.map((x) => BigInt(x));
  return { proofBytes, publicInputs };
}

export async function proofMint(opts: {
  proof: string;
  public: string;
  issuer: string;
  chain: string;
  rpc?: string;
  privateKey?: string;
}) {
  await sendProofTx("mint", opts);
}

export async function proofRenew(opts: {
  proof: string;
  public: string;
  issuer: string;
  chain: string;
  rpc?: string;
  privateKey?: string;
}) {
  await sendProofTx("renew", opts);
}

async function sendProofTx(
  mode: "mint" | "renew",
  opts: {
    proof: string;
    public: string;
    issuer: string;
    chain: string;
    rpc?: string;
    privateKey?: string;
  }
) {
  const rawKey = requirePrivateKey(opts.privateKey ?? process.env["PRIVATE_KEY"]);
  if (!isAddress(opts.issuer)) die(`Invalid issuer address: ${opts.issuer}`);

  const chain = CHAINS[opts.chain] ?? baseSepolia;
  const account = privateKeyToAccount(rawKey);
  const transport = opts.rpc ? http(opts.rpc) : http();

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  console.log();
  console.log(fmt.bold(`  ILAL Credential ZK ${mode === "mint" ? "Mint" : "Renew"}`));
  log.line();
  log.kv("wallet", account.address);
  log.kv("issuer", opts.issuer);
  log.kv("chain", chain.name);
  log.kv("proof", opts.proof);
  log.kv("public", opts.public);
  log.line();

  log.step("Loading snarkjs proof…");
  const { proofBytes, publicInputs } = loadSnarkjsProof(opts.proof, opts.public);
  log.ok(`Proof loaded — ${publicInputs.length} public input(s)`);

  // Show key public input fields (PI_WALLET_HASH=0, PI_EXPIRES_AT=3)
  if (publicInputs.length > 0) log.kv("walletHash (PI[0])", publicInputs[0]!.toString(16).slice(0, 16) + "…");
  if (publicInputs.length > 3) {
    const expiresAt = Number(publicInputs[3]);
    log.kv("expiresAt (PI[3])", new Date(expiresAt * 1000).toISOString());
  }
  log.line();

  log.step(`Sending ${mode === "mint" ? "mintWithProof" : "renewWithProof"} transaction…`);

  const hash = await walletClient.writeContract({
    address: opts.issuer as `0x${string}`,
    abi: CNF_ISSUER_ABI,
    functionName: mode === "mint" ? "mintWithProof" : "renewWithProof",
    args: [proofBytes, publicInputs],
  });

  log.step(`Tx sent: ${hash}`);
  log.step("Waiting for confirmation…");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "success") {
    log.ok(fmt.bold(fmt.green(`CNF ${mode === "mint" ? "minted" : "renewed"} via ZK proof`)));
    log.kv("tx hash", hash);
    log.kv("block", receipt.blockNumber.toString());

    const valid = await publicClient.readContract({
      address: opts.issuer as `0x${string}`,
      abi: CNF_ISSUER_ABI,
      functionName: "isValid",
      args: [account.address],
    });
    log.kv("isValid()", valid ? fmt.green("true") : fmt.red("false"));
  } else {
    die(`Transaction reverted. Hash: ${hash}`);
  }
  console.log();
}
