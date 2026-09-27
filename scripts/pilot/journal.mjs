const ZERO_HASH = `0x${'00'.repeat(32)}`;

export function isCanonicalReceipt(receipt) {
  return receipt?.status === 'success' && receipt.blockHash !== ZERO_HASH;
}
export function reconcileJournalReceipt(row, receipt) {
  if (!isCanonicalReceipt(receipt)) throw new Error(`Non-canonical journal receipt: ${row.transactionHash}`);
  if (row.blockHash !== ZERO_HASH && row.blockHash !== receipt.blockHash) {
    throw new Error(`Reorged journal receipt: ${row.transactionHash}`);
  }
  if (row.contractAddress && row.contractAddress.toLowerCase() !== receipt.contractAddress?.toLowerCase()) {
    throw new Error(`Journal contract mismatch: ${row.transactionHash}`);
  }
  return {
    ...row,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    contractAddress: receipt.contractAddress ?? null,
    gasUsed: receipt.gasUsed.toString(),
  };
}
