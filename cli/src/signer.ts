import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  hexToBytes,
  http,
  isAddress,
  keccak256,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createDecipheriv,
  pbkdf2Sync,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { die, log } from "./ui.js";

export interface GlobalSignerOptions {
  keystore?: string;
  passwordFile?: string;
  rpcAccount?: string;
  unsafePrivateKey?: boolean;
  safe?: string;
  safeTxService?: string;
  ownerKeystore?: string;
  ownerPasswordFile?: string;
  safeOutput?: string;
  submitSafeProposal?: boolean;
}

export interface ExecutionClients {
  kind: "keystore" | "rpc-account" | "unsafe-private-key";
  address: Address;
  account: Account;
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
}

let globalOptions: GlobalSignerOptions = {};

export function configureSignerOptions(options: GlobalSignerOptions): void {
  globalOptions = { ...options };
}

export function signerOptions(): Readonly<GlobalSignerOptions> {
  return globalOptions;
}

function selectedSignerCount(): number {
  return [globalOptions.keystore, globalOptions.rpcAccount, globalOptions.unsafePrivateKey && process.env["PRIVATE_KEY"]]
    .filter(Boolean).length;
}

function validateSignerSelection(): void {
  if (selectedSignerCount() > 1) {
    die("Choose exactly one signer source: --keystore, --rpc-account, or testnet PRIVATE_KEY.");
  }
}

function requireTestnet(chain: Chain): void {
  if (!chain.testnet && chain.id !== 31337 && chain.id !== 1337) {
    die("PRIVATE_KEY compatibility mode is testnet-only. Use --keystore or --rpc-account on production networks.");
  }
}

function parsePrivateKey(rawKey?: string): Hex {
  const key = rawKey?.trim();
  if (!key) die("No signer configured. Use --keystore, --rpc-account, or testnet PRIVATE_KEY with --unsafe-private-key.");
  if (/^[0-9a-fA-F]{64}$/.test(key)) die("Private keys must include the 0x prefix.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) die("Private key must be 32-byte 0x-prefixed hex.");
  return key as Hex;
}

function validatePasswordFilePermissions(path: string): void {
  const stat = statSync(path);
  if ((stat.mode & 0o077) !== 0) {
    die(`Password file permissions are too broad: ${path}. Use chmod 600.`);
  }
}

function readPasswordFile(path: string): string {
  validatePasswordFilePermissions(path);
  return readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
}

async function promptHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    die("Interactive keystore password input requires a TTY. Use --password-file for automation.");
  }

  emitKeypressEvents(process.stdin);
  process.stderr.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return await new Promise<string>((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write("\n");
    };
    const onKeypress = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Password input cancelled."));
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (character && !key.ctrl) value += character;
    };
    process.stdin.on("keypress", onKeypress);
  });
}

interface KeystoreV3 {
  version: number;
  address?: string;
  crypto?: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: "scrypt" | "pbkdf2";
    kdfparams: Record<string, number | string>;
    mac: string;
  };
  Crypto?: KeystoreV3["crypto"];
}

function hexBuffer(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || !/^[0-9a-fA-F]+$/.test(value) || value.length % 2 !== 0) {
    die(`Invalid ${label} in keystore.`);
  }
  return Buffer.from(value, "hex");
}

export function decryptKeystoreV3(contents: string, password: string): Hex {
  let parsed: KeystoreV3;
  try {
    parsed = JSON.parse(contents) as KeystoreV3;
  } catch {
    die("Keystore is not valid JSON.");
  }
  const crypto = parsed.crypto ?? parsed.Crypto;
  if (parsed.version !== 3 || !crypto) die("Only Web3 Secret Storage v3 keystores are supported.");
  if (crypto.cipher.toLowerCase() !== "aes-128-ctr") die(`Unsupported keystore cipher: ${crypto.cipher}`);

  const salt = hexBuffer(crypto.kdfparams["salt"], "KDF salt");
  const dklen = Number(crypto.kdfparams["dklen"]);
  if (!Number.isInteger(dklen) || dklen < 32 || dklen > 64) die("Invalid keystore KDF dklen.");

  let derived: Buffer;
  if (crypto.kdf === "scrypt") {
    const n = Number(crypto.kdfparams["n"]);
    const r = Number(crypto.kdfparams["r"]);
    const p = Number(crypto.kdfparams["p"]);
    if (!Number.isInteger(n) || n < 2 || n > 1_048_576 || (n & (n - 1)) !== 0) die("Invalid scrypt N in keystore.");
    if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) {
      die("Invalid scrypt r/p in keystore.");
    }
    const requiredMemory = 128 * n * r + 128 * r * p + 1_048_576;
    derived = scryptSync(password, salt, dklen, { N: n, r, p, maxmem: Math.max(32 * 1024 * 1024, requiredMemory) });
  } else if (crypto.kdf === "pbkdf2") {
    const iterations = Number(crypto.kdfparams["c"]);
    const prf = String(crypto.kdfparams["prf"] ?? "").toLowerCase();
    if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) die("Invalid PBKDF2 iteration count.");
    if (prf !== "hmac-sha256") die(`Unsupported PBKDF2 PRF: ${prf}`);
    derived = pbkdf2Sync(password, salt, iterations, dklen, "sha256");
  } else {
    die(`Unsupported keystore KDF: ${String(crypto.kdf)}`);
  }

  const ciphertext = hexBuffer(crypto.ciphertext, "ciphertext");
  const expectedMac = hexBuffer(crypto.mac, "MAC");
  const actualMac = hexToBytes(keccak256(bytesToHex(Buffer.concat([derived.subarray(16, 32), ciphertext]))));
  if (expectedMac.length !== actualMac.length || !timingSafeEqual(expectedMac, actualMac)) {
    derived.fill(0);
    die("Keystore password is incorrect or the keystore is corrupted.");
  }

  const iv = hexBuffer(crypto.cipherparams.iv, "cipher IV");
  const decipher = createDecipheriv("aes-128-ctr", derived.subarray(0, 16), iv);
  const privateKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  derived.fill(0);
  if (privateKey.length !== 32) die("Decrypted keystore key is not 32 bytes.");
  const privateKeyHex = bytesToHex(privateKey);
  privateKey.fill(0);

  if (parsed.address) {
    const account = privateKeyToAccount(privateKeyHex);
    const expectedAddress = `0x${parsed.address}`.toLowerCase();
    if (!isAddress(expectedAddress) || account.address.toLowerCase() !== expectedAddress) {
      die("Keystore address does not match its decrypted private key.");
    }
  }
  return privateKeyHex;
}

export async function loadKeystoreAccount(path: string, passwordFile?: string): Promise<Account> {
  const password = passwordFile
    ? readPasswordFile(passwordFile)
    : await promptHidden(`Keystore password for ${path}: `);
  const privateKey = decryptKeystoreV3(readFileSync(path, "utf8"), password);
  return privateKeyToAccount(privateKey);
}

export async function createExecutionClients(params: {
  chain: Chain;
  rpc?: string;
  legacyPrivateKey?: string;
}): Promise<ExecutionClients> {
  validateSignerSelection();
  const transport = params.rpc ? http(params.rpc) : http();
  const publicClient = createPublicClient({ chain: params.chain, transport });

  if (globalOptions.keystore) {
    const account = await loadKeystoreAccount(globalOptions.keystore, globalOptions.passwordFile);
    const walletClient = createWalletClient({ account, chain: params.chain, transport });
    return {
      kind: "keystore",
      address: account.address,
      account,
      publicClient: publicClient as PublicClient<Transport, Chain>,
      walletClient: walletClient as WalletClient<Transport, Chain, Account>,
    };
  }

  if (globalOptions.rpcAccount) {
    if (!isAddress(globalOptions.rpcAccount)) die(`Invalid RPC-managed account: ${globalOptions.rpcAccount}`);
    const rpcChainId = await publicClient.getChainId();
    if (rpcChainId !== params.chain.id) die(`RPC chain mismatch: expected ${params.chain.id}, got ${rpcChainId}.`);
    const accounts = await (publicClient.request as (request: { method: string }) => Promise<Address[]>)({ method: "eth_accounts" });
    const address = globalOptions.rpcAccount as Address;
    if (!accounts.some(account => account.toLowerCase() === address.toLowerCase())) {
      die(`RPC does not manage account ${address}.`);
    }
    const walletClient = createWalletClient({ account: address, chain: params.chain, transport });
    const account = walletClient.account;
    if (!account) die("RPC-managed wallet client did not expose an account.");
    return {
      kind: "rpc-account",
      address,
      account,
      publicClient: publicClient as PublicClient<Transport, Chain>,
      walletClient: walletClient as WalletClient<Transport, Chain, Account>,
    };
  }

  const rawKey = params.legacyPrivateKey ?? process.env["PRIVATE_KEY"];
  if (rawKey) {
    if (!globalOptions.unsafePrivateKey) {
      die("PRIVATE_KEY is disabled by default. Add --unsafe-private-key for an explicit testnet-only compatibility run.");
    }
    requireTestnet(params.chain);
    log.warn("Using testnet-only PRIVATE_KEY compatibility mode; prefer --keystore.");
    const account = privateKeyToAccount(parsePrivateKey(rawKey));
    const walletClient = createWalletClient({ account, chain: params.chain, transport });
    return {
      kind: "unsafe-private-key",
      address: account.address,
      account,
      publicClient: publicClient as PublicClient<Transport, Chain>,
      walletClient: walletClient as WalletClient<Transport, Chain, Account>,
    };
  }

  die("No signer configured. Use --keystore, --rpc-account, or testnet PRIVATE_KEY with --unsafe-private-key.");
}

export interface ForgeSigner {
  address: Address;
  args: string[];
  environment: Record<string, string>;
  kind: "keystore" | "rpc-account" | "unsafe-private-key";
}

function addressFromKeystore(path: string): Address {
  let parsed: KeystoreV3;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as KeystoreV3;
  } catch {
    die("Keystore is not valid JSON.");
  }
  const address = parsed.address?.startsWith("0x") ? parsed.address : `0x${parsed.address ?? ""}`;
  if (parsed.version !== 3 || !isAddress(address)) die("Keystore must include a valid address and version 3 metadata.");
  return address as Address;
}

export async function forgeSignerForExternalProcess(params: {
  chain: Chain;
  rpc: string;
  legacyPrivateKey?: string;
}): Promise<ForgeSigner> {
  validateSignerSelection();
  if (globalOptions.keystore) {
    const keystorePath = resolve(globalOptions.keystore);
    const passwordPath = globalOptions.passwordFile ? resolve(globalOptions.passwordFile) : undefined;
    if (passwordPath) validatePasswordFilePermissions(passwordPath);
    return {
      kind: "keystore",
      address: addressFromKeystore(keystorePath),
      args: [
        "--keystore", keystorePath,
        ...(passwordPath ? ["--password-file", passwordPath] : []),
      ],
      environment: { USE_FOUNDRY_WALLET: "true" },
    };
  }
  if (globalOptions.rpcAccount) {
    if (!isAddress(globalOptions.rpcAccount)) die(`Invalid RPC-managed account: ${globalOptions.rpcAccount}`);
    const publicClient = createPublicClient({ chain: params.chain, transport: http(params.rpc) });
    const rpcChainId = await publicClient.getChainId();
    if (rpcChainId !== params.chain.id) die(`RPC chain mismatch: expected ${params.chain.id}, got ${rpcChainId}.`);
    const accounts = await (publicClient.request as (request: { method: string }) => Promise<Address[]>)({ method: "eth_accounts" });
    const address = globalOptions.rpcAccount as Address;
    if (!accounts.some(account => account.toLowerCase() === address.toLowerCase())) die(`RPC does not manage account ${address}.`);
    return {
      kind: "rpc-account",
      address,
      args: ["--unlocked", "--sender", address],
      environment: { USE_FOUNDRY_WALLET: "true" },
    };
  }
  if (!globalOptions.unsafePrivateKey) die("Forge deployment requires --keystore, --rpc-account, or explicit testnet --unsafe-private-key compatibility mode.");
  requireTestnet(params.chain);
  const privateKey = parsePrivateKey(params.legacyPrivateKey ?? process.env["PRIVATE_KEY"]);
  return {
    kind: "unsafe-private-key",
    address: privateKeyToAccount(privateKey).address,
    args: [],
    environment: { PRIVATE_KEY: privateKey, USE_FOUNDRY_WALLET: "false" },
  };
}
