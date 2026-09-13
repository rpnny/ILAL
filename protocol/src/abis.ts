export const NETTING_ORDER_COMPONENTS = [
  { name: "user", type: "address" },
  { name: "poolId", type: "bytes32" },
  { name: "zeroForOne", type: "bool" },
  { name: "amountIn", type: "uint128" },
  { name: "minAmountOut", type: "uint128" },
  { name: "maxAmmInput", type: "uint128" },
  { name: "deadline", type: "uint64" },
  { name: "nonce", type: "bytes32" },
] as const;

export const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

export const HEADER_COMPONENTS = [
  { name: "batchId", type: "bytes32" },
  { name: "orderCount", type: "uint8" },
  { name: "total0", type: "uint256" },
  { name: "total1", type: "uint256" },
  { name: "matchedEachSide", type: "uint256" },
  { name: "residual0", type: "uint256" },
  { name: "residual1", type: "uint256" },
  { name: "exposureReduction", type: "uint256" },
] as const;

export const NETTING_ROUTER_ABI = [
  {
    name: "poolManager", type: "function", stateMutability: "view", inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "previewBatch", type: "function", stateMutability: "pure",
    inputs: [{ name: "orders", type: "tuple[]", components: NETTING_ORDER_COMPONENTS }],
    outputs: [{ name: "header", type: "tuple", components: HEADER_COMPONENTS }],
  },
  {
    name: "executeBatch", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "orders", type: "tuple[]", components: NETTING_ORDER_COMPONENTS },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [{ name: "batchId", type: "bytes32" }],
  },
  {
    name: "OrderSettled", type: "event", anonymous: false,
    inputs: [
      { name: "batchId", type: "bytes32", indexed: true },
      { name: "orderIndex", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "matchedOutput", type: "uint256", indexed: false },
      { name: "ammOutput", type: "uint256", indexed: false },
    ],
  },
  {
    name: "BatchExecuted", type: "event", anonymous: false,
    inputs: [
      { name: "batchId", type: "bytes32", indexed: true },
      { name: "executor", type: "address", indexed: true },
      { name: "orderCount", type: "uint256", indexed: false },
      { name: "total0", type: "uint256", indexed: false },
      { name: "total1", type: "uint256", indexed: false },
      { name: "matchedEachSide", type: "uint256", indexed: false },
      { name: "residual0", type: "uint256", indexed: false },
      { name: "residual1", type: "uint256", indexed: false },
    ],
  },
] as const;

export const NETTING_HOOK_ABI = [
  { name: "oracleGuard", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "authorizedRouter", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    name: "nonceUsed", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ name: "", type: "bool" }],
  },
  { name: "cancelNonce", type: "function", stateMutability: "nonpayable", inputs: [{ name: "nonce", type: "bytes32" }], outputs: [] },
  {
    name: "NonceCancelled", type: "event", anonymous: false,
    inputs: [{ name: "user", type: "address", indexed: true }, { name: "nonce", type: "bytes32", indexed: true }],
  },
] as const;

export const ORACLE_SNAPSHOT_COMPONENTS = [
  { name: "price0Wad", type: "uint256" },
  { name: "price1Wad", type: "uint256" },
  { name: "updatedAt0", type: "uint256" },
  { name: "updatedAt1", type: "uint256" },
  { name: "sequencerCheckEnabled", type: "bool" },
] as const;

export const ORACLE_GUARD_ABI = [
  { name: "feed0", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "feed1", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "maxAge0", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "maxAge1", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "maxUsdDeviationBps", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "maxPairDeviationBps", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { name: "sequencerUptimeFeed", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "sequencerGracePeriod", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  {
    name: "validate", type: "function", stateMutability: "view", inputs: [],
    outputs: [{ name: "snapshot", type: "tuple", components: ORACLE_SNAPSHOT_COMPONENTS }],
  },
] as const;

export const ERC20_PREFLIGHT_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

export const GAS_PRICE_ORACLE_ABI = [{
  name: "getL1Fee", type: "function", stateMutability: "view",
  inputs: [{ name: "_unsignedTx", type: "bytes" }], outputs: [{ name: "", type: "uint256" }],
}] as const;
