import { getAddress, type Account, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

import { NETTING_ROUTER_ABI } from "./abis.js";
import { batchExecutionArgs, parseBatch, type ILALBatch } from "./batch.js";
import { ProtocolValidationError } from "./errors.js";
import { preflightBatch, type PreflightReport } from "./preflight.js";
import { buildReceipt, type SettlementReceipt } from "./receipt.js";

type Client = PublicClient | any;
type Writer = WalletClient | any;

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
  return buildReceipt({ chainId, transaction: { hash: transaction.hash, from: transaction.from, to: transaction.to, input: transaction.input }, receipt });
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
  const receipt = buildReceipt({ chainId: batch.chainId, transaction: { hash, from: transaction.from, to: transaction.to, input: transaction.input }, receipt: transactionReceipt });
  return { hash, preflight: report, receipt };
}
