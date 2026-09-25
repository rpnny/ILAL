import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {artifact} from './local-deploy.mjs';
import * as sdk from '../../sdk/dist/index.js';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,createWalletClient,http,toHex,encodeAbiParameters,keccak256,erc20Abi,decodeEventLog}=require('viem');
const {privateKeyToAccount}=require('viem/accounts'),{foundry}=require('viem/chains');
const rpc=process.argv[2]??'http://127.0.0.1:8547';if(!['127.0.0.1','localhost'].includes(new URL(rpc).hostname))throw new Error('Local only');
const client=createPublicClient({chain:foundry,transport:http(rpc)});assert.equal(await client.getChainId(),31337);
const d=JSON.parse(readFileSync('artifacts/mixed/local-deployment.json','utf8'));const fixture=JSON.parse(readFileSync('artifacts/mixed/proofs/fixture.json','utf8'));
const wallets=[0xA11CEn,0xB0Bn].map(k=>createWalletClient({account:privateKeyToAccount(toHex(k,{size:32})),chain:foundry,transport:http(rpc)}));
const receipt=async hash=>{const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
const send=async(address,name,fn,args)=>receipt(await wallets[0].writeContract({address,abi:artifact(name).abi,functionName:fn,args}));
let nonce=1000n;
const fresh=()=>toHex(++nonce,{size:32});
async function activate(i,source=3){const p=await sdk.readMixedPolicy(client,d),block=await client.getBlock();const f=fixture.proofs[i];const proof=source&2?f.proof:'0x',inputs=source&2?f.inputs.map(BigInt):[];
 const a={user:wallets[i].account.address,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,source,acceptedRoot:p.config.acceptedRoot,rootEpoch:p.rootEpoch,evidenceHash:keccak256(encodeAbiParameters([{type:'bytes'},{type:'uint256[]'}],[proof,inputs])),deadline:block.timestamp+600n,nonce:fresh()};
 return receipt(await sdk.activateMixedGrant(client,wallets[i],d,a,proof,inputs));
}
async function liquidity(action,delta){const p=await sdk.readMixedPolicy(client,d),b=await client.getBlock();return receipt(await sdk.modifyMixedLiquidity(client,wallets[0],d,{user:wallets[0].account.address,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,action,tickLower:-1000,tickUpper:1000,liquidityDelta:delta,userSalt:toHex(0n,{size:32}),amount0Limit:action===3?(1n<<127n)-1n:0n,amount1Limit:action===3?(1n<<127n)-1n:0n,deadline:b.timestamp+600n,nonce:fresh()}));}
async function orders(count,total0=100000000n,total1=70000000n){const p=await sdk.readMixedPolicy(client,d),b=await client.getBlock();return Array.from({length:count},(_,i)=>({user:wallets[i%2].account.address,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,zeroForOne:i%2===0,amountIn:(i%2===0?total0:total1)/BigInt(count/2),minAmountOut:0n,maxAmmInput:(i%2===0?total0:total1)/BigInt(count/2),minSqrtPriceX96:sdk.MIN_SQRT,maxSqrtPriceX96:sdk.MAX_SQRT,deadline:b.timestamp+600n,nonce:fresh()}));}
async function signed(os,direct=false){return Promise.all(os.map(o=>sdk.signMixedOrder(wallets[o.zeroForOne?0:1],d,o,direct)));}
await sdk.checkMixedDeployment(client,d);
for(const w of wallets)for(const token of [d.pool.currency0,d.pool.currency1])for(const spender of [d.contracts.executionRouter,d.contracts.liquidityRouter])await receipt(await w.writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[spender,(1n<<256n)-1n]}));
await activate(0);await activate(1);await liquidity(3,100000000000000n);
const initial=await client.request({method:'evm_snapshot'});
let first=await orders(2);let quote=await sdk.quoteMixedOrders(client,d,first);assert.equal(quote.allocations.length,2);
for(const o of first)assert.equal(await client.readContract({address:d.contracts.hook,abi:sdk.MixedHookAbi,functionName:'nonceUsed',args:[o.user,0,o.nonce]}),false);
let files=await signed(first);const r=await sdk.executeMixedOrders(client,wallets[0],d,files);assert.equal(r.status,'success');await assert.rejects(()=>sdk.executeMixedOrders(client,wallets[0],d,files));
await receipt(await sdk.cancelMixedNonce(client,wallets[0],d,0,fresh()));
const events=r.logs.flatMap(log=>{try{return [decodeEventLog({abi:sdk.MixedExecutionRouterAbi,...log})];}catch{return [];}}).filter(e=>e.eventName==='OrderSettled');assert.equal(events.length,2);
assert.deepEqual(events.map(e=>e.args.output),quote.allocations.map(a=>a.output));
for(let mode=1;mode<=4;mode++){
 const p=await sdk.readMixedPolicy(client,d);await send(d.contracts.policyRegistry,'MixedPolicyRegistry','configure',[d.pool.poolId,{...p.config,mode}]);
 await client.request({method:'evm_increaseTime',params:[172800]});await client.request({method:'evm_mine',params:[]});await send(d.contracts.policyRegistry,'MixedPolicyRegistry','activate',[d.pool.poolId]);
 await activate(0,mode===1?1:mode===4?3:2);await activate(1,mode===1?1:mode===4?3:2);
 await sdk.executeMixedOrders(client,wallets[0],d,await signed(await orders(2)));
}
await send(d.contracts.policyRegistry,'MixedPolicyRegistry','invalidateRoot',[d.pool.poolId]);await assert.rejects(()=>activate(0));await assert.rejects(async()=>sdk.quoteMixedOrders(client,d,await orders(2)));
await send(d.contracts.policyRegistry,'MixedPolicyRegistry','disable',[d.pool.poolId]);await liquidity(4,-50000000000000n);await liquidity(5,0n);
assert.equal(await client.request({method:'evm_revert',params:[initial]}),true);
writeFileSync('artifacts/mixed/local-e2e.json',sdk.mixedJSON({passed:true,chainId:31337,checks:['SDK deployment bindings','allowance separate from authorization','forced-revert quote does not consume nonce','quote equals actual outputs','replay rejection','namespace cancellation','real Groth16 four policy modes','retired root cannot reactivate','disabled policy owner partial exit and collect'],quote,receipt:r.transactionHash})+'\n');
writeFileSync('artifacts/mixed/local-unsigned-orders.json',sdk.mixedJSON(first)+'\n');
console.log('Local SDK + real PoolManager + real Groth16 end-to-end passed; restored funded, granted LP fixture.');
