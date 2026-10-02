/** Historical evidence verification. No signing, broadcasting or latest-state fallback. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as sdk from '../../sdk/dist/index.js';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {decodeEventLog,encodeFunctionData,encodeAbiParameters,encodePacked,erc20Abi,keccak256,parseAbi,toHex,verifyTypedData}=require('viem');
export const FORMAT='ilal-issuer-pilot-evidence-v2';
const cnfAbi=parseAbi(['function isValid(address) view returns(bool)']);
const managerAbi=parseAbi(['function extsload(bytes32,uint256) view returns(bytes32[])','event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
export const normalized=x=>JSON.parse(sdk.mixedJSON(x));
export function pinned(client,blockNumber){return new Proxy(client,{get(target,key){if(['readContract','simulateContract','getCode'].includes(key))return args=>target[key]({...args,blockNumber});if(key==='getBlock')return ()=>target.getBlock({blockNumber});return target[key];}});}
export async function checkpoint(client,blockNumber){const b=await client.getBlock(blockNumber===undefined?{}:{blockNumber});assert(b.hash&&!/^0x0+$/.test(b.hash),'Canonical block required');return {blockNumber:String(b.number),blockHash:b.hash,timestamp:String(b.timestamp)};}
export function validateV2(e){
 assert.equal(e.format,FORMAT);assert.equal(e.status,'COMPLETE');assert([31337,84532].includes(e.chainId));sdk.validateMixedDeployment(e.deployment);
 assert.equal(e.chainId,e.deployment.chainId);const names=['deployer','issuer','settlementAssetOperator','liquidityProvider','institutionA','institutionB','executor'];
 assert.deepEqual(Object.keys(e.roles).sort(),names.sort());assert.equal(new Set(Object.values(e.roles).map(x=>x.toLowerCase())).size,7);
 for(const [key,role] of [['issuerStablecoin','issuer-stablecoin'],['settlementCash','sandbox-settlement-cash']]){assert.equal(e.assets[key].role,role);assert.equal(e.assets[key].decimals,6);}
 assert.deepEqual(Object.values(e.assets).map(x=>x.address.toLowerCase()).sort(),[e.deployment.pool.currency0,e.deployment.pool.currency1].map(x=>x.toLowerCase()).sort());
 assert(e.deployment.codeHashes&&Object.keys(e.deployment.codeHashes).length===7,'All runtime hashes required');
 for(const name of ['revision','execution','revocation']){const s=e.cases[name];assert.equal(s.signed.length,2);assert(s.quote.snapshot&&s.transaction&&s.before&&s.after);assert.equal(s.quote.snapshot.blockNumber,String(s.quote.snapshot.blockNumber));s.signed.forEach(sdk.parseSignedMixedOrder);}
 assert(e.transactions.proposePolicyChange&&e.transactions.activatePolicyChange&&e.transactions.revokeInstitutionA&&e.transactions.revokeLp&&e.transactions.disablePolicy);
 assert(e.lp.add&&e.lp.collect&&e.lp.exit&&e.snapshot);assert.equal(e.lp.tickLower,-1000);assert.equal(e.lp.tickUpper,1000);
 assert(['read-only-probe','mutable-local-state'].includes(e.oracle.method));
 return e;
}
export async function stateAt(client,e,cp,orders=[]){
 const d=e.deployment,c=pinned(client,BigInt(cp.blockNumber)),users=[e.roles.institutionA,e.roles.institutionB,e.roles.liquidityProvider],tokens=[d.pool.currency0,d.pool.currency1];
 const balances={};for(const user of [...users,d.contracts.poolManager,d.contracts.hook,d.contracts.executionRouter,d.contracts.liquidityRouter])for(const token of tokens)balances[`${user.toLowerCase()}.${token.toLowerCase()}`]=String(await c.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[user]}));
 const slot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[d.pool.poolId,6n]));
 const pool=await c.readContract({address:d.contracts.poolManager,abi:managerAbi,functionName:'extsload',args:[slot,4n]});
 const salt=keccak256(encodeAbiParameters([{type:'address'},{type:'bytes32'}],[e.roles.liquidityProvider,e.lp.userSalt]));
 const positionId=keccak256(encodePacked(['address','int24','int24','bytes32'],[d.contracts.liquidityRouter,e.lp.tickLower,e.lp.tickUpper,salt]));
 const positionSlot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'}],[positionId,toHex(BigInt(slot)+6n,{size:32})]));
 const position=await c.readContract({address:d.contracts.poolManager,abi:managerAbi,functionName:'extsload',args:[positionSlot,3n]});
 const policy=await sdk.readMixedPolicy(c,d);const eligibility={};
 for(const user of users){eligibility[user.toLowerCase()]={valid:policy.config.mode===2?null:await c.readContract({address:policy.config.cnfIssuer,abi:cnfAbi,functionName:'isValid',args:[user]}),banned:await c.readContract({address:d.contracts.policyRegistry,abi:sdk.MixedPolicyRegistryAbi,functionName:'banned',args:[d.pool.poolId,user]}),grant:await c.readContract({address:d.contracts.grantManager,abi:sdk.MixedGrantManagerAbi,functionName:'grants',args:[d.pool.poolId,user]})};}
 const nonces=await Promise.all(orders.map(o=>c.readContract({address:d.contracts.hook,abi:sdk.MixedHookAbi,functionName:'nonceUsed',args:[o.user,0,o.nonce]})));
 return normalized({balances,pool,position,policy,eligibility,nonces});
}
function events(receipt,address,abi,name){return receipt.logs.filter(l=>same(l.address,address)).flatMap(l=>{try{const x=decodeEventLog({abi,...l});return x.eventName===name?[x.args]:[];}catch{return [];}});}
export function flowFromEvents(rows,swaps){
 assert.equal(rows.length,2,'Two settlements required');assert.equal(swaps.length,2,'One PoolManager swap event per order required');swaps=swaps.filter(s=>s.amount0!==0n||s.amount1!==0n);assert.equal(swaps.length,1,'Exactly one nonzero residual swap required');
 const gross=rows.reduce((s,r)=>s+r.input,0n),matched=rows.reduce((s,r)=>s+r.matchedInput,0n),amm=rows.reduce((s,r)=>s+r.ammInput,0n);
 assert.equal(gross,170000000n);assert.equal(matched,140000000n);assert.equal(amm,30000000n);assert.equal(gross-matched,amm);
 const [swap]=swaps;const actual=swap.amount0<0n?-swap.amount0:-swap.amount1;assert.equal(actual,amm,'PoolManager AMM input mismatch');
 assert.equal(rows.reduce((s,r)=>s+r.ammOutput,0n),swap.amount0>0n?swap.amount0:swap.amount1);
 return normalized({grossInstitutionalFlow:gross,internallyMatchedFlow:matched,actualAmmInput:actual});
}
export async function verifyV2(client,e){
 validateV2(e);assert.equal(await client.getChainId(),e.chainId);const d=e.deployment,checks=[],seen=new Map();
 async function block(cp){const actual=await checkpoint(client,BigInt(cp.blockNumber));assert.deepEqual(actual,cp,'Historical checkpoint mismatch');assert(BigInt(cp.blockNumber)<=BigInt(e.snapshot.blockNumber));seen.set(cp.blockNumber,cp);return pinned(client,BigInt(cp.blockNumber));}
 async function receipt(row,status='success'){
  const r=await client.getTransactionReceipt({hash:row.hash});assert.equal(r.status,status);assert.equal(String(r.blockNumber),row.block.blockNumber);assert.equal(r.blockHash,row.block.blockHash);await block(row.block);
  const tx=await client.getTransaction({hash:row.hash});assert(same(tx.from,row.from)&&same(tx.to,row.to),'Transaction identity');assert.equal(tx.input,row.data);assert.equal(tx.value,0n);return r;
 }
 for(const row of Object.values(e.transactions))await receipt(row);
 const finalClient=await block(e.snapshot);await sdk.checkMixedDeployment(finalClient,d);
 const ownerAbi=parseAbi(['function owner() view returns(address)']);
 for(const [address,owner] of [[d.contracts.policyRegistry,e.roles.issuer],[e.assets.issuerStablecoin.address,e.roles.issuer],[e.assets.settlementCash.address,e.roles.settlementAssetOperator]])assert(same(await finalClient.readContract({address,abi:ownerAbi,functionName:'owner'}),owner),'Asset or policy controller');
 for(const token of [d.pool.currency0,d.pool.currency1])assert.equal(await finalClient.readContract({address:token,abi:erc20Abi,functionName:'decimals'}),6);
 async function action(name,address,abi,fn,args,sender){const row=e.transactions[name];assert(row,`Missing ${name}`);assert(same(row.to,address)&&same(row.from,sender));assert.equal(row.data,encodeFunctionData({abi,functionName:fn,args}));return receipt(row);}
 const initialPolicy=await sdk.readMixedPolicy(await block(e.cases.revision.quote.snapshot),d);
 assert.equal(initialPolicy.config.mode,1);assert(same(initialPolicy.config.cnfIssuer,e.deployment.pilot.cnfIssuer));assert(same(await finalClient.readContract({address:initialPolicy.config.cnfIssuer,abi:ownerAbi,functionName:'owner'}),e.roles.issuer));
 const changed={...initialPolicy.config,maxGrantTTL:1800n};assert.equal(initialPolicy.config.maxGrantTTL,3600n);
 const proposal=await action('proposePolicyChange',d.contracts.policyRegistry,sdk.MixedPolicyRegistryAbi,'configure',[d.pool.poolId,changed],e.roles.issuer);
 const activation=await action('activatePolicyChange',d.contracts.policyRegistry,sdk.MixedPolicyRegistryAbi,'activate',[d.pool.poolId],e.roles.issuer);
 assert(BigInt(e.transactions.activatePolicyChange.block.timestamp)>=BigInt(e.transactions.proposePolicyChange.block.timestamp)+172800n,'Real policy timelock');
 for(const name of ['revision','execution','revocation']){
  const s=e.cases[name],files=s.signed.map(sdk.parseSignedMixedOrder),orders=files.map(f=>f.order);
  assert.deepEqual(orders.map(o=>o.user.toLowerCase()).sort(),[e.roles.institutionA,e.roles.institutionB].map(x=>x.toLowerCase()).sort());
  for(const f of files){assert.deepEqual(normalized(f.domain),normalized(sdk.mixedDomain(e.chainId,d.contracts.hook)));assert.equal(f.kind,'batch');assert(await verifyTypedData({...sdk.mixedTypedData(f.order,e.chainId,d.contracts.hook),signature:f.signature,address:f.order.user}),'Invalid signature');}
  const qClient=await block(s.quote.snapshot);assert(BigInt(s.quote.snapshot.blockNumber)<BigInt(s.transaction.block.blockNumber));const q=await sdk.quoteMixedOrders(qClient,d,orders);assert.deepEqual(normalized(q),s.quote,'Historical quote');
  await sdk.prepareMixedExecution(qClient,d,files,e.roles.executor);
  const tx=s.transaction;assert(same(tx.from,e.roles.executor)&&same(tx.to,d.contracts.executionRouter));assert.equal(tx.data,encodeFunctionData({abi:sdk.MixedExecutionRouterAbi,functionName:'executeBatch',args:[d.pool,orders,files.map(f=>f.signature)]}));
  const r=await receipt(tx,name==='execution'?'success':'reverted');assert.equal(s.after.blockNumber,tx.block.blockNumber);assert.equal(BigInt(s.before.blockNumber)+1n,r.blockNumber,'Isolated transaction block required');
  await block(s.before);await block(s.after);const before=await stateAt(client,e,s.before,orders),after=await stateAt(client,e,s.after,orders);
  assert.deepEqual(before,s.stateBefore);assert.deepEqual(after,s.stateAfter);assert(before.nonces.every(x=>!x));
  const trigger=name==='revision'?activation:name==='revocation'?await receipt(e.transactions.revokeInstitutionA):null;
  if(trigger){assert(BigInt(s.quote.snapshot.blockNumber)<trigger.blockNumber&&trigger.blockNumber<=BigInt(s.before.blockNumber));assert.equal(r.logs.length,0);for(const key of ['balances','pool','position','nonces'])assert.deepEqual(after[key],before[key],`Failed ${name} changed ${key}`);
   for(const o of orders){assert(BigInt(o.deadline)>BigInt(s.after.timestamp));const el=before.eligibility[o.user.toLowerCase()];assert.equal(el.banned,false);/* grant expiry is a named ABI result serialized as positional tuple */assert(BigInt(el.grant[4])>BigInt(s.after.timestamp),'Grant expired before negative test');}
   const qc=await stateAt(client,e,s.quote.snapshot,orders);assert(qc.policy.enabled&&before.policy.enabled);
   if(name==='revision'){assert.equal(BigInt(before.policy.revision),BigInt(qc.policy.revision)+1n);assert.equal(before.policy.config.maxGrantTTL,'1800');assert(Object.values(before.eligibility).every(x=>x.valid));for(const user of [e.roles.institutionA,e.roles.institutionB])assert.deepEqual(before.eligibility[user.toLowerCase()],qc.eligibility[user.toLowerCase()]);}
   else {assert.deepEqual(before.policy,qc.policy);assert.equal(before.eligibility[e.roles.institutionA.toLowerCase()].valid,false);assert.equal(before.eligibility[e.roles.institutionB.toLowerCase()].valid,true);for(const user of [e.roles.institutionA,e.roles.institutionB])assert.deepEqual(before.eligibility[user.toLowerCase()].grant,qc.eligibility[user.toLowerCase()].grant);}
   let revert;try{await sdk.prepareMixedExecution(await block(s.before),d,files,e.roles.executor);}catch(error){revert=error;}assert(revert,'Expected historical execution revert');
   // Require contract-level ineligibility, never accept transport failure as proof.
   assert(String(revert).includes('Ineligible')||String(revert).includes(keccak256(new TextEncoder().encode('Ineligible()')).slice(0,10)),'Expected Ineligible revert');
  }else{
   const settled=events(r,d.contracts.executionRouter,sdk.MixedExecutionRouterAbi,'OrderSettled').sort((a,b)=>Number(a.index-b.index));
   const swaps=events(r,d.contracts.poolManager,managerAbi,'Swap').filter(x=>same(x.id,d.pool.poolId));assert(swaps.every(x=>same(x.sender,d.contracts.executionRouter)));
   assert.deepEqual(flowFromEvents(settled,swaps),e.flow);
   for(let i=0;i<settled.length;i++){const x=settled[i],a=q.allocations[i];assert(same(x.user,a.order.user));assert.equal(x.commitment,q.commitment);assert.equal(x.index,BigInt(i));assert.equal(x.zeroForOne,a.order.zeroForOne);assert.equal(x.input,a.order.amountIn);assert.equal(x.output,a.output);assert.equal(x.matchedInput,a.matchedInput);assert.equal(x.matchedOutput,a.matchedOutput);assert.equal(x.ammInput,a.residual);}
   assert(after.nonces.every(Boolean));
   for(const token of [d.pool.currency0,d.pool.currency1]){const transfers=events(r,token,erc20Abi,'Transfer');for(const user of [e.roles.institutionA,e.roles.institutionB,d.contracts.poolManager]){const key=`${user.toLowerCase()}.${token.toLowerCase()}`;const net=transfers.reduce((sum,t)=>sum+(same(t.to,user)?t.value:0n)-(same(t.from,user)?t.value:0n),0n);assert.equal(BigInt(after.balances[key])-BigInt(before.balances[key]),net);if(!same(user,d.contracts.poolManager)){const o=orders.find(o=>same(o.user,user)),allocation=q.allocations.find(a=>same(a.order.user,user));assert.equal(net,same(token,o.zeroForOne?d.pool.currency0:d.pool.currency1)?-o.amountIn:allocation.output);}}}
  }
  checks.push(`${name}: verified`);
 }
 const revokeAbi=parseAbi(['function revoke(address)']);
 await action('revokeInstitutionA',initialPolicy.config.cnfIssuer,revokeAbi,'revoke',[e.roles.institutionA],e.roles.issuer);
 await action('revokeLp',initialPolicy.config.cnfIssuer,revokeAbi,'revoke',[e.roles.liquidityProvider],e.roles.issuer);
 await action('disablePolicy',d.contracts.policyRegistry,sdk.MixedPolicyRegistryAbi,'disable',[d.pool.poolId],e.roles.issuer);
 let added=0n;
 for(const [name,code] of [['add',3],['collect',5],['exit',4]]){
  const s=e.lp[name],r=await receipt(s.transaction);assert(same(s.transaction.from,e.roles.liquidityProvider)&&same(s.transaction.to,d.contracts.liquidityRouter));
  assert.equal(BigInt(s.before.blockNumber)+1n,r.blockNumber);assert.equal(s.after.blockNumber,String(r.blockNumber));await block(s.before);await block(s.after);
  const before=await stateAt(client,e,s.before),after=await stateAt(client,e,s.after);assert.deepEqual(before,s.stateBefore);assert.deepEqual(after,s.stateAfter);
  const rows=events(r,d.contracts.liquidityRouter,sdk.MixedLiquidityRouterAbi,'LiquiditySettled');assert.equal(rows.length,1);const x=rows[0];assert.equal(x.action,code);assert(same(x.user,e.roles.liquidityProvider)&&same(x.poolId,d.pool.poolId));
  const a=s.authorization;assert.equal(a.action,code);assert(same(a.user,e.roles.liquidityProvider)&&same(a.poolId,d.pool.poolId));assert.equal(BigInt(a.liquidityDelta),x.liquidityDelta);assert.equal(x.positionSalt,keccak256(encodeAbiParameters([{type:'address'},{type:'bytes32'}],[e.roles.liquidityProvider,e.lp.userSalt])));assert.equal(s.transaction.data,encodeFunctionData({abi:sdk.MixedLiquidityRouterAbi,functionName:'modify',args:[d.pool,a,s.signature]}));assert.equal(a.tickLower,e.lp.tickLower);assert.equal(a.tickUpper,e.lp.tickUpper);assert.equal(a.userSalt,e.lp.userSalt);
  const amount=BigInt(before.position[0])&((1n<<128n)-1n),remaining=BigInt(after.position[0])&((1n<<128n)-1n);
  if(name==='add'){added=x.liquidityDelta;assert(added>0n);assert.equal(remaining-amount,added);}else {assert.equal(before.policy.enabled,false);assert.equal(before.eligibility[e.roles.liquidityProvider.toLowerCase()].valid,false);
   if(name==='collect'){assert.equal(amount,added);assert.equal(x.liquidityDelta,0n);assert(x.fees0+x.fees1>0n,'Nonzero collect required');assert.equal(remaining,amount);}else {assert.equal(x.liquidityDelta,-added);assert.equal(remaining,0n);}
  }
  for(const [i,token] of [d.pool.currency0,d.pool.currency1].entries()){const key=`${e.roles.liquidityProvider.toLowerCase()}.${token.toLowerCase()}`,delta=BigInt(after.balances[key])-BigInt(before.balances[key]);assert.equal(delta,i===0?x.amount0:x.amount1);const transfers=events(r,token,erc20Abi,'Transfer');assert.equal(delta,transfers.reduce((n,t)=>n+(same(t.to,e.roles.liquidityProvider)?t.value:0n)-(same(t.from,e.roles.liquidityProvider)?t.value:0n),0n));if(name==='collect')assert.equal(delta,i===0?x.fees0:x.fees1);}
 }
 assert(BigInt(e.lp.collect.after.blockNumber)<BigInt(e.lp.exit.before.blockNumber)+1n);
 const oracleClient=await block(e.lp.collect.before);let oracleError;try{const price=e.oracle.method==='read-only-probe'?0n:BigInt(e.lp.collect.stateBefore.pool[0])&((1n<<160n)-1n);await oracleClient.readContract({address:d.contracts.oracle,abi:sdk.MixedOracleGuardAbi,functionName:'validate',args:[price]});}catch(error){oracleError=error;}const oracleSignature=e.oracle.method==='read-only-probe'?'PriceOutsideBand()':'FeedCallFailed(address)';assert(oracleError?.name==='ContractFunctionExecutionError'&&(String(oracleError).includes(oracleSignature.split('(')[0])||String(oracleError).includes(keccak256(new TextEncoder().encode(oracleSignature)).slice(0,10))),'Oracle probe must fail with the expected contract error');if(e.oracle.method==='mutable-local-state')assert.equal(e.chainId,31337,'Mutable oracle testing is local only');
 const last=await stateAt(client,e,e.snapshot);
 for(const address of [d.contracts.hook,d.contracts.executionRouter,d.contracts.liquidityRouter])for(const token of [d.pool.currency0,d.pool.currency1])assert.equal(last.balances[`${address.toLowerCase()}.${token.toLowerCase()}`],'0');
 for(const cp of seen.values())await block(cp);
 return {status:'VERIFIED',checks:[...checks,'nonzero collect and full exit: verified','historical inventory and canonical checkpoints: verified'],flow:e.flow};
}
