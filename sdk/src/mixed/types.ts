import { encodeAbiParameters, keccak256, hashTypedData, type Address, type Hex } from "viem";

export const MixedOrderFields = [{"name": "user", "type": "address"}, {"name": "poolId", "type": "bytes32"}, {"name": "executionPolicyHash", "type": "bytes32"}, {"name": "policyRevision", "type": "uint64"}, {"name": "zeroForOne", "type": "bool"}, {"name": "amountIn", "type": "uint128"}, {"name": "minAmountOut", "type": "uint128"}, {"name": "maxAmmInput", "type": "uint128"}, {"name": "minSqrtPriceX96", "type": "uint160"}, {"name": "maxSqrtPriceX96", "type": "uint160"}, {"name": "deadline", "type": "uint64"}, {"name": "nonce", "type": "bytes32"}] as const;
export interface MixedOrder {
  user: Address;
  poolId: Hex;
  executionPolicyHash: Hex;
  policyRevision: bigint;
  zeroForOne: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  maxAmmInput: bigint;
  minSqrtPriceX96: bigint;
  maxSqrtPriceX96: bigint;
  deadline: bigint;
  nonce: Hex;
}
export function hashMixedOrder(value: MixedOrder, direct=false) {
  return keccak256(encodeAbiParameters([{type:"bytes32"},{type:"tuple",components:MixedOrderFields}], [keccak256(new TextEncoder().encode(`${direct?"MixedDirectSwap":"MixedOrder"}(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint128 maxAmmInput,uint160 minSqrtPriceX96,uint160 maxSqrtPriceX96,uint64 deadline,bytes32 nonce)`)), value]));
}
export const MixedLiquidityFields = [{"name": "user", "type": "address"}, {"name": "poolId", "type": "bytes32"}, {"name": "executionPolicyHash", "type": "bytes32"}, {"name": "policyRevision", "type": "uint64"}, {"name": "action", "type": "uint8"}, {"name": "tickLower", "type": "int24"}, {"name": "tickUpper", "type": "int24"}, {"name": "liquidityDelta", "type": "int128"}, {"name": "userSalt", "type": "bytes32"}, {"name": "amount0Limit", "type": "uint128"}, {"name": "amount1Limit", "type": "uint128"}, {"name": "deadline", "type": "uint64"}, {"name": "nonce", "type": "bytes32"}] as const;
export interface MixedLiquidity {
  user: Address;
  poolId: Hex;
  executionPolicyHash: Hex;
  policyRevision: bigint;
  action: number;
  tickLower: number;
  tickUpper: number;
  liquidityDelta: bigint;
  userSalt: Hex;
  amount0Limit: bigint;
  amount1Limit: bigint;
  deadline: bigint;
  nonce: Hex;
}
export function hashMixedLiquidity(value: MixedLiquidity) {
  return keccak256(encodeAbiParameters([{type:"bytes32"},{type:"tuple",components:MixedLiquidityFields}], [keccak256(new TextEncoder().encode("MixedLiquidity(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,uint8 action,int24 tickLower,int24 tickUpper,int128 liquidityDelta,bytes32 userSalt,uint128 amount0Limit,uint128 amount1Limit,uint64 deadline,bytes32 nonce)")), value]));
}
export const MixedActivationFields = [{"name": "user", "type": "address"}, {"name": "poolId", "type": "bytes32"}, {"name": "executionPolicyHash", "type": "bytes32"}, {"name": "policyRevision", "type": "uint64"}, {"name": "source", "type": "uint8"}, {"name": "acceptedRoot", "type": "uint256"}, {"name": "rootEpoch", "type": "uint64"}, {"name": "evidenceHash", "type": "bytes32"}, {"name": "deadline", "type": "uint64"}, {"name": "nonce", "type": "bytes32"}] as const;
export interface MixedActivation {
  user: Address;
  poolId: Hex;
  executionPolicyHash: Hex;
  policyRevision: bigint;
  source: number;
  acceptedRoot: bigint;
  rootEpoch: bigint;
  evidenceHash: Hex;
  deadline: bigint;
  nonce: Hex;
}
export function hashMixedActivation(value: MixedActivation) {
  return keccak256(encodeAbiParameters([{type:"bytes32"},{type:"tuple",components:MixedActivationFields}], [keccak256(new TextEncoder().encode("MixedActivation(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,uint8 source,uint256 acceptedRoot,uint64 rootEpoch,bytes32 evidenceHash,uint64 deadline,bytes32 nonce)")), value]));
}

export const MixedDirectSwapFields = MixedOrderFields;
export const namespaces = { BATCH_ORDER:0, DIRECT_SWAP:1, GRANT_ACTIVATION:2, LP_ADD:3, LP_EXIT:4, LP_COLLECT:5 } as const;
export function mixedDomain(chainId:number, verifyingContract:Address, grant=false) {
 return { name: grant ? 'ILAL Mixed Grant' : 'ILAL Mixed Hook', version:'1', chainId, verifyingContract } as const;
}
export function orderSetCommitment(orders:MixedOrder[],chainId:number,hook:Address,poolId:Hex) {
 const hashes=orders.map(o=>hashMixedOrder(o)).sort();
 if (hashes.some((h,i)=>i>0&&h===hashes[i-1])) throw new Error('DUPLICATE_ORDER');
 if (orders.some(o=>o.poolId.toLowerCase()!==poolId.toLowerCase())) throw new Error('POOL');
 return keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'address'},{type:'bytes32'},{type:'uint256'},{type:'bytes32[]'}], [keccak256(new TextEncoder().encode('ILAL Mixed order set v1')),BigInt(chainId),hook,poolId,BigInt(hashes.length),hashes]));
}
export function mixedTypedData(order:MixedOrder,chainId:number,hook:Address,direct=false) {
 const domain=mixedDomain(chainId,hook);
 return {domain,types:{MixedDirectSwap:MixedOrderFields,MixedOrder:MixedOrderFields},primaryType:direct?'MixedDirectSwap' as const:'MixedOrder' as const,message:order};
}
export function orderDigest(order:MixedOrder,chainId:number,hook:Address,direct=false) { return hashTypedData(mixedTypedData(order,chainId,hook,direct)); }
