import {
  createPublicClient,
  encodeFunctionData,
  hashTypedData,
  http,
  isAddress,
  isHex,
  zeroAddress,
  type Abi,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { chmodSync, existsSync, lstatSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadKeystoreAccount, signerOptions } from "./signer.js";
import { die, fmt, header, log } from "./ui.js";

const SAFE_ABI = [
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getTransactionHash",
    stateMutability: "view",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "_nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface SafeProposal {
  schemaVersion: 1;
  chainId: number;
  safe: Address;
  to: Address;
  value: string;
  data: Hex;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: Address;
  refundReceiver: Address;
  nonce: string;
  safeTxHash: Hex;
  threshold: string;
  owners: readonly Address[];
  sender?: Address;
  signature?: Hex;
  submitted: boolean;
  transactionService?: string;
  createdAt: string;
}

function serviceEndpoint(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalized);
}

async function submitProposal(serviceUrl: string, proposal: SafeProposal): Promise<void> {
  if (!proposal.sender || !proposal.signature) die("Submitting a Safe proposal requires --owner-keystore.");

  const safeInfo = await fetch(serviceEndpoint(serviceUrl, `api/v1/safes/${proposal.safe}/`), {
    headers: { accept: "application/json" },
  });
  if (!safeInfo.ok) die(`Safe Transaction Service did not recognize ${proposal.safe} (${safeInfo.status}).`);

  const response = await fetch(serviceEndpoint(serviceUrl, `api/v1/safes/${proposal.safe}/multisig-transactions/`), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      safe: proposal.safe,
      to: proposal.to,
      value: proposal.value,
      data: proposal.data,
      operation: proposal.operation,
      gasToken: proposal.gasToken,
      safeTxGas: proposal.safeTxGas,
      baseGas: proposal.baseGas,
      gasPrice: proposal.gasPrice,
      refundReceiver: proposal.refundReceiver,
      nonce: Number(proposal.nonce),
      contractTransactionHash: proposal.safeTxHash,
      sender: proposal.sender,
      signature: proposal.signature,
      origin: "ILAL CLI v0.3.3",
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    die(`Safe proposal submission failed (${response.status}): ${detail}`);
  }
}

export async function proposeSafeTransaction(params: {
  chain: Chain;
  rpc?: string;
  safe: Address;
  to: Address;
  value?: bigint;
  data: Hex;
  operation?: number;
  output?: string;
  txService?: string;
  ownerKeystore?: string;
  ownerPasswordFile?: string;
  submit?: boolean;
}): Promise<SafeProposal> {
  if (!isAddress(params.safe)) die(`Invalid Safe address: ${params.safe}`);
  if (!isAddress(params.to)) die(`Invalid Safe transaction target: ${params.to}`);
  if (!isHex(params.data)) die("Safe transaction data must be 0x-prefixed hex.");
  const operation = params.operation ?? 0;
  if (operation !== 0 && operation !== 1) die("Safe operation must be 0 (CALL) or 1 (DELEGATECALL).");

  const publicClient = createPublicClient({ chain: params.chain, transport: params.rpc ? http(params.rpc) : http() });
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== params.chain.id) die(`RPC chain mismatch: expected ${params.chain.id}, got ${rpcChainId}.`);
  const code = await publicClient.getCode({ address: params.safe });
  if (!code || code === "0x") die(`No Safe contract code at ${params.safe}.`);

  const [owners, threshold, nonce] = await Promise.all([
    publicClient.readContract({ address: params.safe, abi: SAFE_ABI, functionName: "getOwners" }),
    publicClient.readContract({ address: params.safe, abi: SAFE_ABI, functionName: "getThreshold" }),
    publicClient.readContract({ address: params.safe, abi: SAFE_ABI, functionName: "nonce" }),
  ]);

  const message = {
    to: params.to,
    value: params.value ?? 0n,
    data: params.data,
    operation,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  } as const;
  const domain = { chainId: params.chain.id, verifyingContract: params.safe } as const;
  const localHash = hashTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message });
  const contractHash = await publicClient.readContract({
    address: params.safe,
    abi: SAFE_ABI,
    functionName: "getTransactionHash",
    args: [
      message.to,
      message.value,
      message.data,
      message.operation,
      message.safeTxGas,
      message.baseGas,
      message.gasPrice,
      message.gasToken,
      message.refundReceiver,
      message.nonce,
    ],
  });
  if (localHash.toLowerCase() !== contractHash.toLowerCase()) die("Safe transaction hash mismatch between local and on-chain calculation.");

  let sender: Address | undefined;
  let signature: Hex | undefined;
  if (params.ownerKeystore) {
    const owner = await loadKeystoreAccount(params.ownerKeystore, params.ownerPasswordFile);
    if (!owners.some(address => address.toLowerCase() === owner.address.toLowerCase())) {
      die(`${owner.address} is not an owner of Safe ${params.safe}.`);
    }
    if (!owner.signTypedData) die("Safe owner keystore cannot sign EIP-712 data.");
    sender = owner.address;
    signature = await owner.signTypedData({ domain, types: SAFE_TX_TYPES, primaryType: "SafeTx", message });
  }

  const proposal: SafeProposal = {
    schemaVersion: 1,
    chainId: params.chain.id,
    safe: params.safe,
    to: params.to,
    value: message.value.toString(),
    data: params.data,
    operation,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce: nonce.toString(),
    safeTxHash: contractHash,
    threshold: threshold.toString(),
    owners,
    sender,
    signature,
    submitted: false,
    transactionService: params.txService,
    createdAt: new Date().toISOString(),
  };

  const outputPath = resolve(params.output ?? `safe-transaction-${nonce.toString()}.json`);
  if (existsSync(outputPath)) {
    const outputStat = lstatSync(outputPath);
    if (outputStat.isSymbolicLink() || !outputStat.isFile()) die(`Safe output must be a regular file: ${outputPath}`);
  }
  const writeProposal = () => {
    writeFileSync(outputPath, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
    chmodSync(outputPath, 0o600);
  };
  writeProposal();

  if (params.submit) {
    if (!params.txService) die("--submit-safe-proposal requires --safe-tx-service.");
    await submitProposal(params.txService, proposal);
    proposal.submitted = true;
    writeProposal();
  }

  header("Safe Transaction Proposal", params.chain.name);
  log.kv("safe", fmt.addr(params.safe));
  log.kv("target", fmt.addr(params.to));
  log.kv("value", proposal.value);
  log.kv("operation", operation === 0 ? "CALL" : "DELEGATECALL");
  log.kv("nonce", proposal.nonce);
  log.kv("threshold", proposal.threshold);
  log.kv("safeTxHash", fmt.hash(proposal.safeTxHash));
  log.kv("output", outputPath);
  log.kv("status", proposal.submitted ? "submitted for owner confirmations" : "offline proposal only");
  console.log();

  return proposal;
}

export async function safePropose(opts: {
  to: string;
  data: string;
  value?: string;
  operation?: string;
  chain: Chain;
  rpc?: string;
}): Promise<void> {
  const global = signerOptions();
  if (!global.safe || !isAddress(global.safe)) die("Safe address required. Use --safe <address>.");
  if (!isAddress(opts.to)) die(`Invalid target address: ${opts.to}`);
  if (!isHex(opts.data)) die("--data must be 0x-prefixed calldata.");
  const value = BigInt(opts.value ?? "0");
  const operation = Number(opts.operation ?? "0");
  await proposeSafeTransaction({
    chain: opts.chain,
    rpc: opts.rpc,
    safe: global.safe as Address,
    to: opts.to as Address,
    data: opts.data,
    value,
    operation,
    output: global.safeOutput,
    txService: global.safeTxService,
    ownerKeystore: global.ownerKeystore,
    ownerPasswordFile: global.ownerPasswordFile,
    submit: global.submitSafeProposal,
  });
}

export async function proposeConfiguredSafeContractCall(params: {
  chain: Chain;
  rpc?: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}): Promise<boolean> {
  const global = signerOptions();
  if (!global.safe) return false;
  const data = encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
  });
  await proposeSafeTransaction({
    chain: params.chain,
    rpc: params.rpc,
    safe: global.safe as Address,
    to: params.address,
    data,
    output: global.safeOutput,
    txService: global.safeTxService,
    ownerKeystore: global.ownerKeystore,
    ownerPasswordFile: global.ownerPasswordFile,
    submit: global.submitSafeProposal,
  });
  return true;
}
