/** Same pool, same initial state, same fees, input notionals and execution reference valuation. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifact} from './local-deploy.mjs';
import * as sdk from '../../sdk/dist/index.js';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,createWalletClient,http,toHex,decodeEventLog,parseAbi,keccak256,encodeAbiParameters,erc20Abi,zeroAddress}=require('viem');
const {privateKeyToAccount}=require('viem/accounts'),{foundry}=require('viem/chains');
const rpc='http://127.0.0.1:8547',client=createPublicClient({chain:foundry,transport:http(rpc),cacheTime:0,pollingInterval:50});assert.equal(await client.getChainId(),31337);
const d=JSON.parse(readFileSync('artifacts/mixed/local-deployment.json','utf8'));
const wallets=[0xA11CEn,0xB0Bn].map(k=>createWalletClient({account:privateKeyToAccount(toHex(k,{size:32})),chain:foundry,transport:http(rpc),cacheTime:0}));
let nonce=100000n;const fresh=()=>toHex(++nonce,{size:32});
const snapshot=()=>client.request({method:'evm_snapshot'});const restore=async s=>assert.equal(await client.request({method:'evm_revert',params:[s]}),true);
const slot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[d.pool.poolId,6n]));
const price=async()=>BigInt(await client.readContract({address:d.contracts.poolManager,abi:parseAbi(['function extsload(bytes32) view returns(bytes32)']),functionName:'extsload',args:[slot]}))&((1n<<160n)-1n);
async function order(side,amount){const p=await sdk.readMixedPolicy(client,d),b=await client.getBlock({blockTag:'latest'});return {user:wallets[side?0:1].account.address,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,zeroForOne:side,amountIn:amount,minAmountOut:0n,maxAmmInput:amount,minSqrtPriceX96:sdk.MIN_SQRT,maxSqrtPriceX96:sdk.MAX_SQRT,deadline:b.timestamp+600n,nonce:fresh()};}
const signs=(os,direct=false)=>Promise.all(os.map(o=>sdk.signMixedOrder(wallets[o.zeroForOne?0:1],d,o,direct)));
function settlements(r){return r.logs.flatMap(log=>{try{const e=decodeEventLog({abi:sdk.MixedExecutionRouterAbi,...log});return e.eventName==='OrderSettled'?[e.args]:[];}catch{return [];}});}
const execute=async(os,direct=false)=>{const r=await sdk.executeMixedOrders(client,wallets[0],d,await signs(os,direct));return {gas:r.gasUsed,rows:settlements(r)};};
async function changeLiquidity(delta){const o=await order(true,1n);const a={user:o.user,poolId:o.poolId,executionPolicyHash:o.executionPolicyHash,policyRevision:o.policyRevision,action:delta>0n?3:4,tickLower:-1000,tickUpper:1000,liquidityDelta:delta,userSalt:toHex(0n,{size:32}),amount0Limit:delta>0n?(1n<<127n)-1n:0n,amount1Limit:delta>0n?(1n<<127n)-1n:0n,deadline:o.deadline,nonce:fresh()};const hash=await sdk.modifyMixedLiquidity(client,wallets[0],d,a);assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');}
const evidence={format:'ilal-mixed-economics-v1',valuation:'token0 at pre-execution reference price; token units=1e-6; gas cost modeled separately',baseline:'Unhooked Uniswap v4 pool, same initial sqrt price, liquidity/ticks, fee500, token amounts and canonical batch ordering. Each exact-input order executes via v4 PoolSwapTest. This test router is not a production gas-minimal router.',fees:{matched:0,protocol:0,residualPoolBps:5},gasAssumptions:{gasPriceGwei:1,ethUSD:3000,token0USD:1},cases:[],failures:[],strategies:[]};
async function tx(wallet,address,name,fn,args){const hash=await wallet.writeContract({address,abi:artifact(name).abi,functionName:fn,args});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;}
async function deploy(name){const a=artifact(name);const hash=await wallets[0].deployContract({abi:a.abi,bytecode:a.bytecode.object,args:[d.contracts.poolManager]});const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r.contractAddress;}
const baseSwap=await deploy('PoolSwapTest'),baseLP=await deploy('PoolModifyLiquidityTest');
for(const w of wallets)for(const token of [d.pool.currency0,d.pool.currency1])for(const spender of [baseSwap,baseLP]){const hash=await w.writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[spender,(1n<<256n)-1n]});assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');}
const baseKey={...d.pool,hooks:zeroAddress};
async function baseline(o){const wallet=wallets[o.zeroForOne?0:1],token=o.zeroForOne?d.pool.currency1:d.pool.currency0;
 const before=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[o.user]});
 const r=await tx(wallet,baseSwap,'PoolSwapTest','swap',[baseKey,{zeroForOne:o.zeroForOne,amountSpecified:-o.amountIn,sqrtPriceLimitX96:o.zeroForOne?sdk.MIN_SQRT:sdk.MAX_SQRT},{takeClaims:false,settleUsingBurn:false},'0x']);
 const after=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[o.user]});return {gas:r.gasUsed,output:after-before};
}
const global=await snapshot();
try{
 for(const liquidity of [100000000000000n,1000000000000n])for(const nonParity of [false,true]){
  const env=await snapshot();if(liquidity<100000000000000n)await changeLiquidity(liquidity-100000000000000n);
  if(nonParity)await execute([await order(false,liquidity*25n/10000n)],true);
  await tx(wallets[0],d.contracts.poolManager,'PoolManager','initialize',[baseKey,await price()]);
  await tx(wallets[0],baseLP,'PoolModifyLiquidityTest','modifyLiquidity',[baseKey,{tickLower:-1000,tickUpper:1000,liquidityDelta:liquidity,salt:toHex(0n,{size:32})},'0x']);
  for(const count of [2,4,8,16])for(const ratio of [100n,70n,20n]){
   const start=await snapshot(),os=[];for(let i=0;i<count;i++)os.push(await order(i%2===0,(i%2===0?100n:ratio)*1000000n/BigInt(count/2)));
   os.sort((a,b)=>sdk.hashMixedOrder(a)<sdk.hashMixedOrder(b)?-1:1);
   const reference=await price(),q=await sdk.quoteMixedOrders(client,d,os);const mixed=await execute(os);const mixedRows=mixed.rows;
   await restore(start);const baselineStart=await snapshot();let baselineGas=0n,baseRows=[];
   for(const o of os){const b=await baseline(o);baselineGas+=b.gas;baseRows.push(b);}
   const valued=(amount,token1)=>token1?amount*sdk.Q192/(reference*reference):amount;
   const users=os.map((o,i)=>({user:o.user,input:o.amountIn,zeroForOne:o.zeroForOne,mixedOutput:mixedRows[i].output,directOutput:baseRows[i].output,deltaToken0Raw:valued(mixedRows[i].output-baseRows[i].output,o.zeroForOne)}));
   const ammInput=mixedRows.reduce((s,r)=>s+valued(r.ammInput,!r.zeroForOne),0n),input=os.reduce((s,o)=>s+valued(o.amountIn,!o.zeroForOne),0n);
   const gross=users.reduce((s,u)=>s+u.deltaToken0Raw,0n),gasDelta=mixed.gas-baselineGas;
   evidence.cases.push({count,liquidity,nonParity,ratioPercent:ratio,referencePrice:reference,inputToken0Raw:input,ammInputToken0Raw:ammInput,compressionBps:(input-ammInput)*10000n/input,mixedGas:mixed.gas,directGas:baselineGas,gasDelta,otherCostToken0Raw:0,grossImprovementToken0Raw:gross,netImprovementToken0Raw:gross-gasDelta*3000n/1000n,worstOrderDeltaToken0Raw:users.reduce((m,u)=>u.deltaToken0Raw<m?u.deltaToken0Raw:m,users[0].deltaToken0Raw),residualLPFeesToken0Raw:mixedRows.reduce((s,r)=>s+valued((r.ammInput*500n+999999n)/1000000n,!r.zeroForOne),0n),users});
   assert.deepEqual(mixedRows.map(r=>r.output),q.allocations.map(a=>a.output));await restore(baselineStart);
  }
  // Fixed signed set permutation: outputs/commitment identical at restored state.
  const os=[await order(true,70000000n),await order(false,40000000n),await order(true,30000000n),await order(false,30000000n)];
  const q1=await sdk.quoteMixedOrders(client,d,os),q2=await sdk.quoteMixedOrders(client,d,[...os].reverse());assert.equal(q1.commitment,q2.commitment);assert.deepEqual(q1.allocations,q2.allocations);
  let best=null,worst=null;for(let i=0;i<24;i++){const varied=os.map(o=>({...o,nonce:fresh()}));const q=await sdk.quoteMixedOrders(client,d,varied);const own=q.allocations.filter(a=>a.order.zeroForOne).reduce((s,a)=>s+a.output,0n);best=best===null||own>best?own:best;worst=worst===null||own<worst?own:worst;}
  const unsplit=await sdk.quoteMixedOrders(client,d,[await order(true,100000000n),await order(false,70000000n)]);
  const unsplitOwn=unsplit.allocations.find(a=>a.order.zeroForOne).output;
  evidence.strategies.push({liquidity,nonParity,fixedSetPermutationIndependent:true,nonceTrials:24,bestSplitOutput:best,worstSplitOutput:worst,unsplitOutput:unsplitOwn,bestSplitGainRaw:best-unsplitOwn});
  for(const [name,mutate] of [['no-match',os=>os.map(o=>({...o,zeroForOne:true,user:wallets[0].account.address}))],['expired',os=>os.map(o=>({...o,deadline:1n}))],['capacity-price-band',os=>os.map((o,i)=>({...o,amountIn:i?1n:liquidity,maxAmmInput:liquidity}))],['minimum-output',os=>os.map(o=>({...o,minAmountOut:(1n<<127n)-1n}))]]){
   const failed=mutate([await order(true,100000000n),await order(false,70000000n)]);try{await sdk.quoteMixedOrders(client,d,failed);throw new Error('Unexpected success');}catch(e){if(e.message==='Unexpected success')throw e;evidence.failures.push({liquidity,nonParity,name,message:e.shortMessage??e.message.split('\n')[0]});}
  }
  await restore(env);
 }
}finally{await restore(global);}
writeFileSync('artifacts/mixed/economics.json',sdk.mixedJSON(evidence)+'\n');
console.log(`${evidence.cases.length} same-state economic comparisons; ${evidence.failures.length} retained failures; ${evidence.strategies.length} splitting/grinding trials.`);
