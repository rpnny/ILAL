import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import * as sdk from '../../sdk/dist/index.js';
import {FORMAT,checkpoint,stateAt,normalized,verifyV2,pinned} from './evidence-v2.mjs';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {encodeAbiParameters,encodeFunctionData,keccak256,toHex,parseAbi}=require('viem');
const cnfAbi=parseAbi(['function issue(address,uint64) returns(uint256)','function revoke(address)']);
const tokenAbi=parseAbi(['function mint(address,uint256)','function approve(address,uint256) returns(bool)']);
const zero=toHex(0n,{size:32});
/** Transactions are signed once and persisted before broadcast. Retry sends identical bytes. */
export async function lifecycleV2({client,wallets,manifest,journalPath,outputPath,localOracle,onSigned}){
 const d=manifest,roles=manifest.pilot.roles,assets=manifest.pilot.assets;
 const save=()=>{mkdirSync(dirname(journalPath),{recursive:true});writeFileSync(`${journalPath}.tmp`,sdk.mixedJSON(journal)+'\n',{mode:0o600});renameSync(`${journalPath}.tmp`,journalPath);};
 const identity=keccak256(new TextEncoder().encode(sdk.mixedJSON({chainId:d.chainId,contracts:d.contracts,roles})));
 const journal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):{identity,serial:0,steps:{},evidence:{format:FORMAT,status:'INCOMPLETE',chainId:d.chainId,roles,assets,deployment:d,cases:{},transactions:{},lp:{userSalt:zero,tickLower:-1000,tickUpper:1000},oracle:{method:localOracle?'mutable-local-state':'read-only-probe'}}};
 assert.equal(journal.identity,identity,'Journal deployment identity');const e=journal.evidence;
 for(const [role,address] of Object.entries(roles))assert.equal(wallets[role].account.address.toLowerCase(),address.toLowerCase());
 const fresh=()=>{journal.serial++;save();return toHex(BigInt(journal.serial),{size:32});};
 async function send(label,role,address,abi,fn,args,expected='success'){
  const data=encodeFunctionData({abi,functionName:fn,args}),wallet=wallets[role];let step=journal.steps[label];
  if(!step){const request=await wallet.prepareTransactionRequest({account:wallet.account,to:address,data,value:0n,gas:expected==='reverted'?2000000n:undefined});const serialized=await wallet.signTransaction(request);step=journal.steps[label]={serialized,hash:keccak256(serialized),from:roles[role],to:address,data,expected};save();if(onSigned){assert.equal(d.chainId,31337);await onSigned(label);}}
  assert.equal(step.data,data,`Resume calldata mismatch: ${label}`);assert.equal(step.expected,expected);
  let r;try{r=await client.getTransactionReceipt({hash:step.hash});}catch(error){if(error.name!=='TransactionReceiptNotFoundError')throw error;}
  if(!r){try{await client.sendRawTransaction({serializedTransaction:step.serialized});}catch(error){try{await client.getTransaction({hash:step.hash});}catch{throw error;}}r=await client.waitForTransactionReceipt({hash:step.hash,timeout:120000});}
  const until=Date.now()+120000;while(!r.blockHash||r.blockHash===zero){assert(Date.now()<until,'Canonical receipt timed out; resume journal');await new Promise(resolve=>setTimeout(resolve,1000));r=await client.getTransactionReceipt({hash:step.hash});}
  assert.equal(r.status,expected,`Unexpected receipt: ${label}`);const block=await checkpoint(client,r.blockNumber);if(step.block)assert.deepEqual(block,step.block);step.block=block;save();return {hash:step.hash,from:step.from,to:step.to,data:step.data,block};
 }
 async function once(key,fn){if(!(key in journal)){journal[key]=normalized(await fn());save();}return journal[key];}
 const cnf=manifest.pilot.cnfIssuer,registry=d.contracts.policyRegistry;
 const initial=await once('initialPolicy',()=>sdk.readMixedPolicy(client,d));
 const policyConfig={...initial.config,maxGrantTTL:1800n};
 e.transactions.proposePolicyChange=await send('proposePolicyChange','issuer',registry,sdk.MixedPolicyRegistryAbi,'configure',[d.pool.poolId,policyConfig]);save();
 const readyAt=BigInt(e.transactions.proposePolicyChange.block.timestamp)+172800n;
 if((await client.getBlock()).timestamp<readyAt){if(d.chainId===31337){await client.request({method:'evm_increaseTime',params:[Number(readyAt-(await client.getBlock()).timestamp+1n)]});await client.request({method:'evm_mine',params:[]});}else{return {status:'WAITING_TIMELOCK',activateAfter:String(readyAt),resumeAt:new Date(Number(readyAt)*1000).toISOString()};}}
 const expiry=await once('credentialExpiry',async()=>String((await client.getBlock()).timestamp+30n*86400n));
 for(const role of ['liquidityProvider','institutionA','institutionB'])e.transactions[`issue${role}`]=await send(`issue${role}`,'issuer',cnf,cnfAbi,'issue',[roles[role],BigInt(expiry)]);
 for(const [label,role,asset,user,value] of [['mintALp','issuer','issuerStablecoin','liquidityProvider',1000000000000000n],['mintA','issuer','issuerStablecoin','institutionA',1000000000000n],['mintBLp','settlementAssetOperator','settlementCash','liquidityProvider',1000000000000000n],['mintB','settlementAssetOperator','settlementCash','institutionB',1000000000000n]])e.transactions[label]=await send(label,role,assets[asset].address,tokenAbi,'mint',[roles[user],value]);
 for(const [role,asset,router] of [['liquidityProvider','issuerStablecoin','liquidityRouter'],['liquidityProvider','settlementCash','liquidityRouter'],['institutionA','issuerStablecoin','executionRouter'],['institutionB','settlementCash','executionRouter']]){const label=`approve-${role}-${asset}`;e.transactions[label]=await send(label,role,assets[asset].address,tokenAbi,'approve',[d.contracts[router],(1n<<256n)-1n]);}
 async function grant(role,label){const cached=await once(label,async()=>{const p=await sdk.readMixedPolicy(client,d),b=await client.getBlock();const a={user:roles[role],poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,source:1,acceptedRoot:p.config.acceptedRoot,rootEpoch:p.rootEpoch,evidenceHash:keccak256(encodeAbiParameters([{type:'bytes'},{type:'uint256[]'}],['0x',[]])),deadline:b.timestamp+1800n,nonce:fresh()};const signature=await wallets[role].signTypedData({account:wallets[role].account,domain:sdk.mixedDomain(d.chainId,d.contracts.grantManager,true),types:{MixedActivation:sdk.MixedActivationFields},primaryType:'MixedActivation',message:a});return {a,signature};});e.transactions[label]=await send(label,role,d.contracts.grantManager,sdk.MixedGrantManagerAbi,'activate',[cached.a,cached.signature,'0x',[]]);save();}
 for(const role of ['liquidityProvider','institutionA','institutionB'])await grant(role,`initialGrant-${role}`);
 async function lp(name,action,delta){const cached=await once(`lp-${name}`,async()=>{const p=await sdk.readMixedPolicy(client,d),b=await client.getBlock();const authorization={user:roles.liquidityProvider,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,action,tickLower:-1000,tickUpper:1000,liquidityDelta:delta,userSalt:zero,amount0Limit:action===3?(1n<<127n)-1n:0n,amount1Limit:action===3?(1n<<127n)-1n:0n,deadline:b.timestamp+1800n,nonce:fresh()};const signature=await wallets.liquidityProvider.signTypedData({account:wallets.liquidityProvider.account,domain:sdk.mixedDomain(d.chainId,d.contracts.hook),types:{MixedLiquidity:sdk.MixedLiquidityFields},primaryType:'MixedLiquidity',message:authorization});return {authorization,signature};});const tx=await send(`lp-${name}`,'liquidityProvider',d.contracts.liquidityRouter,sdk.MixedLiquidityRouterAbi,'modify',[d.pool,cached.authorization,cached.signature]);const before=await checkpoint(client,BigInt(tx.block.blockNumber)-1n),after=tx.block;e.lp[name]={...cached,transaction:tx,before,after,stateBefore:await stateAt(client,e,before),stateAfter:await stateAt(client,e,after)};save();}
 await lp('add',3,100000000000000n);
 async function quote(name){return once(`case-${name}`,async()=>{const p=await sdk.readMixedPolicy(client,d),b=await client.getBlock(),a0=assets.issuerStablecoin.address.toLowerCase()===d.pool.currency0.toLowerCase();const orders=['institutionA','institutionB'].map((role,i)=>({user:roles[role],poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,zeroForOne:i===0?a0:!a0,amountIn:i===0?100000000n:70000000n,minAmountOut:0n,maxAmmInput:i===0?100000000n:70000000n,minSqrtPriceX96:sdk.MIN_SQRT,maxSqrtPriceX96:sdk.MAX_SQRT,deadline:b.timestamp+1800n,nonce:fresh()}));const quote=await sdk.quoteMixedOrders(pinned(client,b.number),d,orders),signed=await Promise.all(orders.map((o,i)=>sdk.signMixedOrder(wallets[i===0?'institutionA':'institutionB'],d,o)));return {quote,signed};});}
 async function execute(name,status){const s=await quote(name),files=s.signed.map(sdk.parseSignedMixedOrder),orders=files.map(x=>x.order);const tx=await send(`execute-${name}`,'executor',d.contracts.executionRouter,sdk.MixedExecutionRouterAbi,'executeBatch',[d.pool,orders,files.map(x=>x.signature)],status);const before=await checkpoint(client,BigInt(tx.block.blockNumber)-1n),after=tx.block;e.cases[name]={...s,transaction:tx,before,after,stateBefore:await stateAt(client,e,before,orders),stateAfter:await stateAt(client,e,after,orders)};save();}
 await quote('revision');e.transactions.activatePolicyChange=await send('activatePolicyChange','issuer',registry,sdk.MixedPolicyRegistryAbi,'activate',[d.pool.poolId]);save();await execute('revision','reverted');
 for(const role of ['liquidityProvider','institutionA','institutionB'])await grant(role,`updatedGrant-${role}`);
 await execute('execution','success');
 await quote('revocation');e.transactions.revokeInstitutionA=await send('revokeInstitutionA','issuer',cnf,cnfAbi,'revoke',[roles.institutionA]);save();await execute('revocation','reverted');
 e.transactions.revokeLp=await send('revokeLp','issuer',cnf,cnfAbi,'revoke',[roles.liquidityProvider]);e.transactions.disablePolicy=await send('disablePolicy','issuer',registry,sdk.MixedPolicyRegistryAbi,'disable',[d.pool.poolId]);save();
 if(localOracle)e.transactions.breakOracle=await send('breakOracle','deployer',localOracle,parseAbi(['function setShouldRevert(bool)']),'setShouldRevert',[true]);
 await lp('collect',5,0n);await lp('exit',4,-100000000000000n);
 e.snapshot=await checkpoint(client,BigInt(e.lp.exit.after.blockNumber));e.flow={grossInstitutionalFlow:'170000000',internallyMatchedFlow:'140000000',actualAmmInput:'30000000'};e.status='COMPLETE';save();
 const result=await verifyV2(client,e);mkdirSync(dirname(outputPath),{recursive:true});writeFileSync(outputPath,sdk.mixedJSON(e)+'\n');return result;
}
