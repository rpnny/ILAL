import { describe,it,expect } from 'vitest';
import { matchingBudget,allocateMatch,MIN_SQRT,MAX_SQRT } from './model.js';
import { orderSetCommitment, type MixedOrder } from './types.js';
describe('Mixed integer reference',()=>{
 it('retains both-side rounding dust and conserves each currency',()=>{
  for(const s of [MIN_SQRT,1n<<96n,MAX_SQRT]) for(let i=1n;i<=128n;i++) {
   const b=matchingBudget(i*1000000n+300000n,i*700000n,s);
   const a=allocateMatch(b,true,0n,i*1000000n), c=allocateMatch(b,true,i*1000000n,300000n), d=allocateMatch(b,false,0n,i*700000n);
   expect(a.matchedInput+c.matchedInput).toBe(d.matchedOutput);
   expect(a.matchedOutput+c.matchedOutput).toBe(d.matchedInput);
  }
 });
 it('canonical commitment ignores caller permutation but rejects duplicate hashes',()=>{
  const z=`0x${'00'.repeat(32)}` as const, hook=`0x${'11'.repeat(20)}` as const;
  const a:MixedOrder={user:hook,poolId:z,executionPolicyHash:z,policyRevision:1n,zeroForOne:true,amountIn:100n,minAmountOut:1n,maxAmmInput:100n,minSqrtPriceX96:MIN_SQRT,maxSqrtPriceX96:MAX_SQRT,deadline:9999999999n,nonce:z};
  const b={...a,zeroForOne:false};
  expect(orderSetCommitment([a,b],84532,hook,z)).toBe(orderSetCommitment([b,a],84532,hook,z));
  expect(()=>orderSetCommitment([a,a],84532,hook,z)).toThrow('DUPLICATE');
 });
});
