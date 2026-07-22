import { createPublicClient, http, isAddress, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, die } from "../ui.js";
import { withConfig } from "../config.js";

const CNF_ABI = [
  { name: "isValid", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "credentialOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ name: "tokenId", type: "uint256" as const }] },
  { name: "getCredential", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "tokenId", type: "uint256" as const }], outputs: [{ type: "tuple" as const, components: [{ name: "holder", type: "address" as const }, { name: "issuer", type: "address" as const }, { name: "credentialType", type: "bytes32" as const }, { name: "issuedAt", type: "uint64" as const }, { name: "expiresAt", type: "uint64" as const }, { name: "revoked", type: "bool" as const }] }] },
] as const;

const CHAINS: Record<string, Chain> = {
  "8453": base,
  "84532": baseSepolia,
};

export async function credentialStatus(opts: {
  wallet: string;
  issuer?: string;
  rpc?: string;
  chain?: string;
}) {
  const cfg = withConfig(opts);
  if (!isAddress(cfg.wallet)) die(`Invalid wallet address: ${cfg.wallet}`);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or run `ilal init`.");
  if (!isAddress(cfg.issuer)) die(`Invalid issuer address: ${cfg.issuer}`);

  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const transport = cfg.rpc ? http(cfg.rpc) : http();
  const client = createPublicClient({ chain, transport });

  console.log();
  console.log(fmt.bold("  ILAL Credential Status"));
  log.line();
  log.kv("wallet", cfg.wallet);
  log.kv("issuer", cfg.issuer);
  log.kv("chain", chain.name);
  log.line();

  log.step("Querying CNFIssuer on-chain…");

  const [valid, tokenId] = await Promise.all([
    client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "isValid", args: [cfg.wallet as `0x${string}`] }),
    client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "credentialOf", args: [cfg.wallet as `0x${string}`] }),
  ]);

  if ((tokenId as bigint) === 0n) {
    log.fail("No credential found for this wallet");
    console.log();
    console.log(fmt.bold("  How to get a CNF credential:"));
    console.log();
    console.log(fmt.bold("  Issuer path — issuer-created EAS attestation"));
    console.log(`  ${fmt.gray("1.")} Ask the issuer/operator to run:`);
    console.log(`       ${fmt.cyan("PRIVATE_KEY=<issuer-key> ilal issuer attest --wallet " + cfg.wallet)}`);
    console.log(`  ${fmt.gray("2.")} Then mint with your wallet key:`);
    console.log(`       ${fmt.cyan("PRIVATE_KEY=<wallet-key> ilal credential mint --attestation <uid>")}`);
    console.log();
    console.log(fmt.bold("  Path A — Coinbase Verifications (EAS)"));
    console.log(`  ${fmt.gray("1.")} Complete KYC at ${fmt.cyan("https://coinbase.com/onchain-verify")}`);
    console.log(`  ${fmt.gray("2.")} Find your attestation UID on EAS Explorer:`);
    const easExplorer = chain.id === 8453
      ? "https://base.easscan.org"
      : "https://base-sepolia.easscan.org";
    console.log(`       ${fmt.cyan(easExplorer)}`);
    console.log(`       ${fmt.gray("Filter: Attester = 0x357458739F90461b99789350868CD7CF330Dd7EE")}`);
    console.log(`  ${fmt.gray("3.")} Run: ${fmt.cyan("ilal credential mint --attestation <uid>")}`);
    console.log();
    console.log(fmt.bold("  Path B — ZK proof (privacy-preserving, no KYC data on-chain)"));
    console.log(`  ${fmt.gray("1.")} Issuer/operator adds wallet to the Merkle tree`);
    console.log(`  ${fmt.gray("2.")} Operator queues root: ${fmt.cyan("ilal oracle propose-root --root <newMerkleRoot>")}`);
    console.log(`  ${fmt.gray("3.")} After timelock, operator activates: ${fmt.cyan("ilal oracle activate-root")}`);
    console.log(`  ${fmt.gray("4.")} Trader runs: ${fmt.cyan("ilal credential prove --wallet " + cfg.wallet)}`);
    console.log();
    return;
  }

  const cred = await client.readContract({
    address: cfg.issuer as `0x${string}`,
    abi: CNF_ABI,
    functionName: "getCredential",
    args: [tokenId as bigint],
  }) as { holder: string; issuer: string; credentialType: string; issuedAt: bigint; expiresAt: bigint; revoked: boolean };

  const expiresAt = new Date(Number(cred.expiresAt) * 1000);
  const issuedAt = new Date(Number(cred.issuedAt) * 1000);
  const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);

  log.kv("token ID", (tokenId as bigint).toString());
  log.kv("issued", issuedAt.toISOString().split("T")[0]!);
  log.kv("expires", expiresAt.toISOString().split("T")[0]! + (daysLeft > 0 ? fmt.gray(` (${daysLeft}d remaining)`) : ""));
  log.kv("revoked", cred.revoked ? fmt.red("yes") : "no");
  log.line();

  if (valid) {
    log.ok(fmt.bold(fmt.green("Credential valid — wallet can trade")));
  } else if (cred.revoked) {
    log.fail(fmt.bold("Credential revoked"));
  } else {
    log.fail(fmt.bold("Credential expired — renew with ilal credential renew"));
  }
  console.log();
}
