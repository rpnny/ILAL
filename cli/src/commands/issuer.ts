import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  createPublicClient,
  decodeEventLog,
  isAddress,
  keccak256,
  stringToBytes,
  isHex,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, header, log, die, Spinner, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";
import { createExecutionClients } from "../signer.js";

type IssuerStandard = {
  id: `0x${string}`;
  standard: string;
  allowedJurisdictions: string[];
  accreditedOnly: boolean | null;
  createdAt: string;
  updatedAt: string;
};

type IssuerStore = {
  version: 1;
  latest?: `0x${string}`;
  standards: Record<string, IssuerStandard>;
};

const STORE_FILE = ".ilal-issuer-standards.json";
const ZERO = "0x0000000000000000000000000000000000000000";
const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

const CNF_ISSUER_ATTEST_ABI = [
  { name: "eas", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "schemaUID", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "bytes32" as const }] },
  { name: "trustedAttester", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

const OWNABLE_ABI = [
  { name: "owner", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
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
    outputs: [{ name: "uid", type: "bytes32" as const }],
  },
] as const;

const EAS_ABI = [
  {
    type: "event" as const,
    name: "Attested",
    inputs: [
      { name: "recipient", type: "address" as const, indexed: true },
      { name: "attester", type: "address" as const, indexed: true },
      { name: "uid", type: "bytes32" as const, indexed: false },
      { name: "schemaUID", type: "bytes32" as const, indexed: true },
    ],
  },
  {
    name: "attest",
    type: "function" as const,
    stateMutability: "payable" as const,
    inputs: [{
      name: "request",
      type: "tuple" as const,
      components: [
        { name: "schema", type: "bytes32" as const },
        {
          name: "data",
          type: "tuple" as const,
          components: [
            { name: "recipient", type: "address" as const },
            { name: "expirationTime", type: "uint64" as const },
            { name: "revocable", type: "bool" as const },
            { name: "refUID", type: "bytes32" as const },
            { name: "data", type: "bytes" as const },
            { name: "value", type: "uint256" as const },
          ],
        },
      ],
    }],
    outputs: [{ name: "uid", type: "bytes32" as const }],
  },
] as const;

function storePath(): string {
  return resolve(process.cwd(), STORE_FILE);
}

function loadStore(): IssuerStore {
  const path = storePath();
  if (!existsSync(path)) return { version: 1, standards: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as IssuerStore;
    return {
      version: 1,
      latest: parsed.latest,
      standards: parsed.standards ?? {},
    };
  } catch {
    die(`Could not parse ${STORE_FILE}. Fix or remove the file and try again.`);
  }
}

function saveStore(store: IssuerStore): void {
  writeFileSync(storePath(), JSON.stringify(store, null, 2) + "\n");
}

function normalizeId(id?: string, store?: IssuerStore): `0x${string}` {
  const resolved = id ?? store?.latest;
  if (!resolved) die("Standard id required. Pass --id <standard_id> or run `ilal issuer create` first.");
  if (!isHex(resolved) || resolved.length !== 66) die("standard_id must be 0x + 32 bytes.");
  return resolved as `0x${string}`;
}

function parseJurisdictions(raw: string): string[] {
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (list.length === 0) die("--allow must include at least one jurisdiction, e.g. US,EU,SG");
  return [...new Set(list)];
}

function parseBool(raw: string | boolean): boolean {
  if (typeof raw === "boolean") return raw;
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(value)) return true;
  if (["false", "0", "no", "n"].includes(value)) return false;
  die("--accredited-only must be true or false");
}

function printStandard(item: IssuerStandard): void {
  log.kv("standard_id", fmt.cyan(item.id));
  log.kv("standard", item.standard);
  log.kv("jurisdictions", item.allowedJurisdictions.length ? item.allowedJurisdictions.join(", ") : fmt.badge("unset", "yellow"));
  log.kv("accredited only", item.accreditedOnly === null ? fmt.badge("unset", "yellow") : String(item.accreditedOnly));
  log.kv("credentialType", fmt.cyan(item.id));
  log.kv("updated", fmt.gray(item.updatedAt));
}

function txUrl(chain: Chain, hash: `0x${string}`): string | undefined {
  const baseUrl = chain.blockExplorers?.default?.url;
  return baseUrl ? `${baseUrl}/tx/${hash}` : undefined;
}

function parseHexBytes(raw?: string): `0x${string}` {
  if (!raw) return "0x";
  if (!isHex(raw)) die("--data must be hex bytes, e.g. 0x1234");
  return raw as `0x${string}`;
}

async function isMockEAS(client: ReturnType<typeof createPublicClient>, eas: `0x${string}`): Promise<boolean> {
  try {
    await client.readContract({ address: eas, abi: OWNABLE_ABI, functionName: "owner" });
    return true;
  } catch {
    return false;
  }
}

export async function issuerCreate(opts: { standard: string }) {
  const standard = opts.standard.trim();
  if (!standard) die("--standard <name> required");

  const store = loadStore();
  const now = new Date().toISOString();
  const id = keccak256(stringToBytes(`ILAL_STANDARD_V1:${standard}`));

  const existing = store.standards[id];
  const item: IssuerStandard = existing ?? {
    id,
    standard,
    allowedJurisdictions: [],
    accreditedOnly: null,
    createdAt: now,
    updatedAt: now,
  };
  item.standard = standard;
  item.updatedAt = now;
  store.standards[id] = item;
  store.latest = id;
  saveStore(store);

  header("Issuer Standard Created");
  log.section("Standard");
  printStandard(item);
  log.line();
  log.callout("Use this id as credentialType", `ilal pool policy set --cred-type ${id}`, "green");
  log.kv("file", fmt.gray(storePath()));
  console.log();
}

export async function issuerSetJurisdiction(opts: { id?: string; allow: string }) {
  const store = loadStore();
  const id = normalizeId(opts.id, store);
  const item = store.standards[id];
  if (!item) die(`Unknown standard_id ${id}. Run \`ilal issuer create --standard <name>\` first.`);

  item.allowedJurisdictions = parseJurisdictions(opts.allow);
  item.updatedAt = new Date().toISOString();
  store.latest = id;
  saveStore(store);

  header("Issuer Jurisdiction Updated");
  log.section("Standard");
  printStandard(item);
  log.kv("file", fmt.gray(storePath()));
  console.log();
}

export async function issuerSetType(opts: { id?: string; accreditedOnly: string | boolean }) {
  const store = loadStore();
  const id = normalizeId(opts.id, store);
  const item = store.standards[id];
  if (!item) die(`Unknown standard_id ${id}. Run \`ilal issuer create --standard <name>\` first.`);

  item.accreditedOnly = parseBool(opts.accreditedOnly);
  item.updatedAt = new Date().toISOString();
  store.latest = id;
  saveStore(store);

  header("Issuer Investor Type Updated");
  log.section("Standard");
  printStandard(item);
  log.kv("file", fmt.gray(storePath()));
  console.log();
}

export async function issuerGet(opts: { id?: string }) {
  const store = loadStore();
  const id = normalizeId(opts.id, store);
  const item = store.standards[id];
  if (!item) die(`Unknown standard_id ${id}. Available standards: ${Object.keys(store.standards).length}`);

  header("Issuer Standard");
  log.section("Standard");
  printStandard(item);
  log.line();
  log.info("This CLI profile is the issuer-side descriptor. Pools enforce the matching credentialType on-chain via PolicyRegistry.");
  log.command(`ilal pool policy set --cred-type ${item.id} --issuer <CNFIssuer> --registry <PolicyRegistry> --pool <poolId>`);
  console.log();
}

export async function issuerAttest(opts: {
  wallet: string;
  schema?: string;
  eas?: string;
  issuer?: string;
  expiresInDays?: string;
  data?: string;
  revocable?: boolean;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!isAddress(opts.wallet)) die(`Invalid wallet address: ${opts.wallet}`);

  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const { account, publicClient: client, walletClient } = await createExecutionClients({
    chain,
    rpc: cfg.rpc,
    legacyPrivateKey: cfg.privateKey,
  });

  let eas = opts.eas;
  let schema = opts.schema;
  let trustedAttester = account.address;

  if (cfg.issuer) {
    if (!isAddress(cfg.issuer)) die(`Invalid issuer address: ${cfg.issuer}`);
    const [issuerEAS, issuerSchema, issuerAttester] = await Promise.all([
      client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ISSUER_ATTEST_ABI, functionName: "eas" }) as Promise<string>,
      client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ISSUER_ATTEST_ABI, functionName: "schemaUID" }) as Promise<string>,
      client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ISSUER_ATTEST_ABI, functionName: "trustedAttester" }) as Promise<string>,
    ]);
    if (!eas && issuerEAS !== ZERO) eas = issuerEAS;
    if (!schema) schema = issuerSchema;
    trustedAttester = issuerAttester as `0x${string}`;
  }

  if (!eas || !isAddress(eas)) die("EAS contract required. Use --eas <address> or configure an issuer with eas().");
  if (!schema || !isHex(schema) || schema.length !== 66) die("Schema UID required. Use --schema <bytes32> or configure an issuer with schemaUID().");

  const days = BigInt(parseInt(opts.expiresInDays ?? "365", 10));
  if (days <= 0n) die("--expires-in-days must be greater than 0");
  const expiration = BigInt(Math.floor(Date.now() / 1000)) + days * 24n * 60n * 60n;
  const data = parseHexBytes(opts.data);
  const mock = await isMockEAS(client, eas as `0x${string}`);

  header("Issuer Attestation", chain.name);
  log.kv("issuer", cfg.issuer ? fmt.addr(cfg.issuer) : fmt.badge("direct EAS", "yellow"));
  log.kv("eas", fmt.addr(eas));
  log.kv("schema", fmt.hash(schema));
  log.kv("recipient", fmt.addr(opts.wallet));
  log.kv("signer", fmt.addr(account.address));
  log.kv("attester", mock ? fmt.addr(trustedAttester) : fmt.addr(account.address));
  log.kv("expires", new Date(Number(expiration) * 1000).toISOString());
  log.kv("mode", mock ? "MockEAS compatibility" : "EAS attest()");
  log.line();

  const spin = new Spinner("Creating issuer attestation…").start();
  let hash: `0x${string}`;
  try {
    if (mock) {
      hash = await walletClient.writeContract({
        address: eas as `0x${string}`,
        abi: MOCK_EAS_ABI,
        functionName: "attest",
        args: [schema as `0x${string}`, opts.wallet as `0x${string}`, trustedAttester as `0x${string}`, expiration, data],
      });
    } else {
      hash = await walletClient.writeContract({
        address: eas as `0x${string}`,
        abi: EAS_ABI,
        functionName: "attest",
        args: [{
          schema: schema as `0x${string}`,
          data: {
            recipient: opts.wallet as `0x${string}`,
            expirationTime: expiration,
            revocable: opts.revocable ?? true,
            refUID: `0x${"0".repeat(64)}` as `0x${string}`,
            data,
            value: 0n,
          },
        }],
        value: 0n,
      });
    }
  } catch (e) {
    spin.fail("attest failed");
    dieOnContract(e);
  }

  const receipt = await client.waitForTransactionReceipt({ hash });
  spin.succeed(`Attestation tx confirmed ${fmt.gray(fmt.hash(hash))}`);

  let uid: string | undefined;
  for (const logItem of receipt.logs) {
    if (logItem.address.toLowerCase() !== eas.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: mock ? MOCK_EAS_ABI : EAS_ABI, data: logItem.data, topics: logItem.topics });
      if (decoded.eventName === "AttestationCreated" || decoded.eventName === "Attested") {
        uid = decoded.args.uid;
        break;
      }
    } catch {}
  }

  log.line();
  if (uid) log.kv("attestation", fmt.cyan(uid));
  else log.warn("Could not decode attestation UID from logs; inspect the tx in the explorer.");
  log.kv("tx", fmt.gray(hash));
  const explorer = txUrl(chain, hash);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  if (uid) {
    log.callout("CNF mint path ready", "recipient can mint CNF without issuer involvement", "green");
    log.command(`ilal --keystore <wallet.json> credential mint --issuer ${cfg.issuer ?? "<CNFIssuer>"} --attestation ${uid} --chain ${chain.id}`);
  }
  console.log();
}
