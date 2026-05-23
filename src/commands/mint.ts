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
import { fmt, log, die } from "../ui.js";
import { EAS_ADDRESSES, COINBASE_SCHEMA_UID, COINBASE_ATTESTER } from "../constants.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

const CNF_ISSUER_ABI = [
  {
    name: "mintWithEAS",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "attestationUID", type: "bytes32" as const }],
    outputs: [{ name: "tokenId", type: "uint256" as const }],
  },
  {
    name: "renewWithEAS",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "attestationUID", type: "bytes32" as const }],
    outputs: [],
  },
  {
    name: "isValid",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "wallet", type: "address" as const }],
    outputs: [{ type: "bool" as const }],
  },
  { name: "eas", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "schemaUID", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "bytes32" as const }] },
  { name: "trustedAttester", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

async function sendMintTx(
  mode: "mint" | "renew",
  opts: {
    attestation: string;
    issuer: string;
    chain: string;
    rpc?: string;
    privateKey?: string;
    simulate: boolean;
  }
) {
  const rawKey = opts.privateKey ?? process.env["PRIVATE_KEY"];
  if (!rawKey) die("Private key required. Use --private-key or set PRIVATE_KEY env var.");
  if (!isHex(rawKey) || rawKey.length !== 66) die("Invalid private key (expected 0x + 32 bytes).");
  if (!isAddress(opts.issuer)) die(`Invalid issuer address: ${opts.issuer}`);
  if (!isHex(opts.attestation) || opts.attestation.length !== 66)
    die("Attestation UID must be 0x + 32 bytes (64 hex chars).");

  const chain = CHAINS[opts.chain] ?? baseSepolia;
  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const transport = opts.rpc ? http(opts.rpc) : http();

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  console.log();
  console.log(fmt.bold(`  ILAL Credential ${mode === "mint" ? "Mint" : "Renew"}`));
  log.line();
  log.kv("wallet", account.address);
  log.kv("issuer", opts.issuer);
  log.kv("attestation", opts.attestation);
  log.kv("chain", chain.name);
  if (opts.simulate) log.kv("mode", fmt.yellow("simulate (no tx sent)"));
  log.line();

  // Verify EAS attestation exists on-chain before sending tx
  log.step("Verifying attestation on EAS…");

  const [issuerEAS, issuerSchema, issuerAttester] = await Promise.all([
    publicClient.readContract({ address: opts.issuer as `0x${string}`, abi: CNF_ISSUER_ABI, functionName: "eas" }) as Promise<string>,
    publicClient.readContract({ address: opts.issuer as `0x${string}`, abi: CNF_ISSUER_ABI, functionName: "schemaUID" }) as Promise<string>,
    publicClient.readContract({ address: opts.issuer as `0x${string}`, abi: CNF_ISSUER_ABI, functionName: "trustedAttester" }) as Promise<string>,
  ]);

  const easAddress = issuerEAS !== ZERO_ADDRESS ? issuerEAS : EAS_ADDRESSES[chain.id];
  if (!easAddress) die(`No EAS contract known for chain ${chain.id}. Use an issuer with eas() configured.`);

  const EAS_ABI = [
    {
      name: "getAttestation",
      type: "function" as const,
      stateMutability: "view" as const,
      inputs: [{ name: "uid", type: "bytes32" as const }],
      outputs: [{
        type: "tuple" as const,
        components: [
          { name: "uid", type: "bytes32" as const },
          { name: "schema", type: "bytes32" as const },
          { name: "time", type: "uint64" as const },
          { name: "expirationTime", type: "uint64" as const },
          { name: "revocationTime", type: "uint64" as const },
          { name: "refUID", type: "bytes32" as const },
          { name: "recipient", type: "address" as const },
          { name: "attester", type: "address" as const },
          { name: "revocable", type: "bool" as const },
          { name: "data", type: "bytes" as const },
        ],
      }],
    },
  ] as const;

  const attestation = await publicClient.readContract({
    address: easAddress as `0x${string}`,
    abi: EAS_ABI,
    functionName: "getAttestation",
    args: [opts.attestation as `0x${string}`],
  }) as {
    uid: string; schema: string; recipient: string; attester: string;
    revocationTime: bigint; expirationTime: bigint;
  };

  if (attestation.uid === "0x" + "0".repeat(64)) die("Attestation not found on EAS.");
  if (attestation.revocationTime !== 0n) die("Attestation has been revoked.");
  if (attestation.expirationTime !== 0n && attestation.expirationTime < BigInt(Math.floor(Date.now() / 1000)))
    die("Attestation has expired.");
  if (attestation.recipient.toLowerCase() !== account.address.toLowerCase())
    die(`Attestation recipient (${attestation.recipient}) does not match your wallet (${account.address}).`);

  log.ok(`Attester: ${attestation.attester}`);
  if (attestation.attester.toLowerCase() === issuerAttester.toLowerCase()) {
    log.ok("Issuer trusted attester confirmed");
  } else if (attestation.attester.toLowerCase() === COINBASE_ATTESTER.toLowerCase()) {
    log.ok("Coinbase Verifications attester confirmed");
  } else {
    log.warn(`Attester mismatch — issuer expects ${issuerAttester}`);
  }

  if (attestation.schema.toLowerCase() !== issuerSchema.toLowerCase()) {
    log.warn(`Schema mismatch — issuer expects ${issuerSchema}, got ${attestation.schema}`);
  } else if (attestation.schema.toLowerCase() === COINBASE_SCHEMA_UID.toLowerCase()) {
    log.ok("Coinbase Account Verification schema confirmed");
  } else {
    log.ok("Issuer schema confirmed");
  }

  log.line();

  if (opts.simulate) {
    log.ok("Simulation complete — attestation valid, tx would succeed");
    console.log();
    console.log(`  Run without ${fmt.cyan("--simulate")} to send the transaction.`);
    console.log();
    return;
  }

  log.step(`Sending ${mode === "mint" ? "mintWithEAS" : "renewWithEAS"} transaction…`);

  const hash = await walletClient.writeContract({
    address: opts.issuer as `0x${string}`,
    abi: CNF_ISSUER_ABI,
    functionName: mode === "mint" ? "mintWithEAS" : "renewWithEAS",
    args: [opts.attestation as `0x${string}`],
  });

  log.step(`Tx sent: ${hash}`);
  log.step("Waiting for confirmation…");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status === "success") {
    log.ok(fmt.bold(fmt.green(`CNF ${mode === "mint" ? "minted" : "renewed"} successfully`)));
    log.kv("tx hash", hash);
    log.kv("block", receipt.blockNumber.toString());

    const valid = await publicClient.readContract({
      address: opts.issuer as `0x${string}`,
      abi: CNF_ISSUER_ABI,
      functionName: "isValid",
      args: [account.address],
    });
    log.kv("isValid()", valid ? fmt.green("true ✓") : fmt.red("false"));
  } else {
    die(`Transaction reverted. Hash: ${hash}`);
  }
  console.log();
}

export const mintCredential = (opts: Parameters<typeof sendMintTx>[1]) =>
  sendMintTx("mint", opts);

export const renewCredential = (opts: Parameters<typeof sendMintTx>[1]) =>
  sendMintTx("renew", opts);
