import { keccak256, type Hex } from "viem";

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

const names = new Map<string, string>([
  ["FeedCallFailed(address)", "CHAINLINK_FEED_CALL_FAILED"],
  ["InvalidRound(address,uint80,uint256)", "CHAINLINK_INVALID_ROUND"],
  ["InvalidAnswer(address,int256)", "CHAINLINK_INVALID_ANSWER"],
  ["FutureTimestamp(address,uint256,uint256)", "CHAINLINK_FUTURE_TIMESTAMP"],
  ["StalePrice(address,uint256,uint256)", "CHAINLINK_STALE_PRICE"],
  ["PegDeviationExceeded(uint8,uint256,uint256)", "CHAINLINK_PEG_DEVIATION"],
  ["PairDeviationExceeded(uint256,uint256,uint256)", "CHAINLINK_PAIR_DEVIATION"],
  ["SequencerDown()", "CHAINLINK_SEQUENCER_DOWN"],
  ["SequencerInvalidTimestamp(uint256,uint256)", "CHAINLINK_SEQUENCER_INVALID_TIMESTAMP"],
  ["SequencerGracePeriodNotOver(uint256,uint256)", "CHAINLINK_SEQUENCER_GRACE_PERIOD"],
  ["OrderExpired()", "ILAL_ORDER_EXPIRED"],
  ["NonceAlreadyUsed()", "ILAL_NONCE_ALREADY_USED"],
  ["PolicyNotConfigured()", "ILAL_POLICY_NOT_CONFIGURED"],
  ["CredentialInvalid()", "ILAL_CREDENTIAL_INVALID"],
  ["PegTickExceeded(int24,int24)", "ILAL_POOL_TICK_EXCEEDED"],
  ["AmmInputLimitExceeded(uint256,uint256)", "ILAL_AMM_INPUT_LIMIT_EXCEEDED"],
  ["ERC20TransferFailed()", "ILAL_ERC20_TRANSFER_FAILED"],
  ["IncompleteFill(uint256,uint256)", "ILAL_INCOMPLETE_FILL"],
  ["SlippageTooHigh(uint256,uint256)", "ILAL_SLIPPAGE_TOO_HIGH"],
].map(([signature, name]) => [keccak256(new TextEncoder().encode(signature)).slice(0, 10), name]));

export function decodeProtocolRevert(error: unknown): { selector: Hex | null; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const seen = new Set<object>();
  let current: unknown = error;
  let revertData: string | null = null;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (typeof value["data"] === "string" && /^0x[0-9a-fA-F]{8,}$/.test(value["data"])) {
      revertData = value["data"];
      break;
    }
    current = value["cause"];
  }
  if (!revertData) revertData = message.match(/0x[0-9a-fA-F]{8}(?![0-9a-fA-F])/)?.[0] ?? null;
  const selector = revertData ? revertData.slice(0, 10).toLowerCase() as Hex : null;
  return { selector, message: (selector ? names.get(selector) : undefined) ?? message.split("\n")[0]!.slice(0, 500) };
}

export function isNamedProtocolRevert(selector: Hex | null): boolean {
  return selector !== null && names.has(selector);
}
