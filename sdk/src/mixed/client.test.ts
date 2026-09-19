import {describe,it,expect} from 'vitest';
import {parseMixedOrder,parseSignedMixedOrder,quoteResult} from './client.js';
import {hashMixedOrder,mixedDomain} from './types.js';
import {encodeErrorResult} from 'viem';
import {MixedExecutionRouterAbi} from './abi.js';
const h=`0x${'11'.repeat(32)}` as const;
const raw={user:`0x${'22'.repeat(20)}`,poolId:h,executionPolicyHash:h,policyRevision:'1',zeroForOne:true,amountIn:'100',minAmountOut:'0',maxAmmInput:'100',minSqrtPriceX96:'1',maxSqrtPriceX96:'2',deadline:'2000000000',nonce:h};
describe('Mixed input boundary',()=>{
 it('rejects floating point, signed, overflow and inverted range amounts',()=>{
  expect(parseMixedOrder(raw).amountIn).toBe(100n);
  for(const amountIn of [100,'1.2','-1','0',(1n<<127n).toString()])expect(()=>parseMixedOrder({...raw,amountIn})).toThrow();
  expect(()=>parseMixedOrder({...raw,minSqrtPriceX96:'3'})).toThrow();
 });
 it('rejects legacy signed order domains and keeps direct type separate',()=>{
  const order=parseMixedOrder(raw),domain=mixedDomain(31337,raw.user as `0x${string}`);
  expect(hashMixedOrder(order)).not.toBe(hashMixedOrder(order,true));
  expect(parseSignedMixedOrder({format:'ilal-mixed-order-v1',kind:'batch',domain,order,signature:'0x11'}).order).toEqual(order);
  expect(()=>parseSignedMixedOrder({format:'ilal-mixed-order-v1',kind:'batch',domain:{...domain,version:'2'},order,signature:'0x11'})).toThrow();
 });
 it('extracts only the intentional quote revert, preserving other failures',()=>{
  const data=encodeErrorResult({abi:MixedExecutionRouterAbi,errorName:'QuoteResult',args:[h,[7n,8n]]});
  expect(quoteResult({cause:{data}})).toEqual([h,[7n,8n]]);
  const failure=new Error('Oracle unavailable');expect(()=>quoteResult(failure)).toThrow(failure);
 });
});
