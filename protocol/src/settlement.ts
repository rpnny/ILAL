import { getAddress, type Account, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

import { NETTING_ROUTER_ABI } from "./abis.js";
import { batchExecutionArgs, parseBatch, type ILALBatch } from "./batch.js";
import { ProtocolValidationError } from "./errors.js";
import { preflightBatch, type PreflightReport } from "./preflight.js";
import { buildReceipt, type SettlementReceipt } from "./receipt.js";

type Client = PublicClient | any;
type Writer = WalletClient | any;
const ZERO_HASH = `0x${"00".repeat(32)}`;

async function canonicalReceiptEvidence(publicClient: Client, transaction: any, receipt: any): Promise<any> {
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  if (!block.hash || block.hash.toLowerCase() === ZERO_HASH) throw new Error("Settlement block hash is unavailable.");
  if (receipt.blockHash && receipt.blockHash.toLowerCase() !== ZERO_HASH && receipt.blockHash.toLowerCase() !== block.hash.toLowerCase()) {
    throw new ProtocolValidationError("Transaction receipt block hash does not match the canonical block.");
  }
  if (transaction.blockNumber !== null && transaction.blockNumber !== undefined && transaction.blockNumber !== receipt.blockNumber) {
    throw new ProtocolValidationError("Transaction and receipt block numbers differ.");
  }
  if (transaction.blockHash && transaction.blockHash.toLowerCase() !== ZERO_HASH && transaction.blockHash.toLowerCase() !== block.hash.toLowerCase()) {
    throw new ProtocolValidationError("Transaction block hash does not match the canonical block.");
  }
  return { ...receipt, blockHash: block.hash };
}

export class SettlementRejectedError extends Error {
  readonly report: PreflightReport;
  constructor(report: PreflightReport) {
    super(`Preflight ${report.status}; the batch was not sent.`);
    this.name = "SettlementRejectedError";
    this.report = report;
  }
}

export async function inspectSettlement(publicClient: Client, transactionHash: Hex): Promise<SettlementReceipt> {
  const [chainId, transaction, receipt] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getTransaction({ hash: transactionHash }),
    publicClient.getTransactionReceipt({ hash: transactionHash }),
  ]);
  const canonicalReceipt = await canonicalReceiptEvidence(publicClient, transaction, receipt);
  return buildReceipt({ chainId, transaction: { hash: transaction.hash, from: transaction.from, to: transaction.to, input: transaction.input }, receipt: canonicalReceipt });
}

export async function executeBatch(input: {
  publicClient: Client;
  walletClient: Writer;
  account: Account | Address;
  batch: ILALBatch;
}): Promise<{ hash: Hex; preflight: PreflightReport; receipt: SettlementReceipt }> {
  const batch = parseBatch(input.batch);
  const accountAddress = getAddress(typeof input.account === "string" ? input.account : input.account.address);
  const report = await preflightBatch(input.publicClient, batch, { from: accountAddress });
  if (report.status !== "executable") throw new SettlementRejectedError(report);
  const execution = batchExecutionArgs(batch);
  const onchain = await input.publicClient.readContract({ address: batch.router, abi: NETTING_ROUTER_ABI, functionName: "previewBatch", args: [execution.orders] });
  if (onchain.batchId.toLowerCase() !== batch.batchId.toLowerCase()) throw new ProtocolValidationError("Local and on-chain batch commitments differ.");
  const hash = await input.walletClient.writeContract({
    account: input.account,
    address: batch.router,
    abi: NETTING_ROUTER_ABI,
    functionName: "executeBatch",
    args: [execution.poolKey, execution.orders, execution.signatures],
    chain: input.walletClient.chain,
  }) as Hex;
  const transactionReceipt = await input.publicClient.waitForTransactionReceipt({ hash });
  if (transactionReceipt.status !== "success") throw new Error(`Batch transaction reverted: ${hash}`);
  const transaction = await input.publicClient.getTransaction({ hash });
  const canonicalReceipt = await canonicalReceiptEvidence(input.publicClient, transaction, transactionReceipt);
  const receipt = buildReceipt({ chainId: batch.chainId, transaction: { hash, from: transaction.from, to: transaction.to, input: transaction.input }, receipt: canonicalReceipt });
  return { hash, preflight: report, receipt };
}
