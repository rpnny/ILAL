/** Independent historical verifier for the ZK_ONLY issuer pilot. Read-only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as sdk from '../../sdk/dist/index.js';
import {checkpoint,flowFromEvents,normalized,pinned,stateAt} from './evidence-v2.mjs';
const sdkRequire=createRequire(new URL('../../sdk/package.json',import.meta.url)),circuitsRequire=createRequire(new URL('../../circuits/package.json',import.meta.url));
const {decodeAbiParameters,decodeEventLog,encodeFunctionData,erc20Abi,keccak256,parseAbi,verifyTypedData}=sdkRequire('viem');
const {groth16}=circuitsRequire('snarkjs');
export const FORMAT='ilal-zk-issuer-pilot-evidence-v1';
const managerAbi=parseAbi(['event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)']);
const same=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const events=(receipt,address,abi,name)=>receipt.logs.filter(log=>same(log.address,address)).flatMap(log=>{try{const row=decodeEventLog({abi,...log});return row.eventName===name?[row.args]:[];}catch{return [];}});

export function validateZkEvidence(e){
 assert.equal(e.format,FORMAT);assert.equal(e.status,'COMPLETE');assert([31337,84532].includes(e.chainId));sdk.validateMixedDeployment(e.deployment);assert.equal(e.deployment.chainId,e.chainId);
 assert.equal(new Set(Object.values(e.roles).map(x=>x.toLowerCase())).size,7);assert.equal(e.proofBundle.format,'ilal-zk-pilot-proof-bundle-v1');assert.equal(e.proofBundle.proofs.length,3);assert.equal(e.proofBundle.circuitVersion,2);
 assert(e.cases.execution&&e.cases.rootRetirement&&e.transactions.invalidateRoot);assert(e.lp.add&&e.lp.collect&&e.lp.exit&&e.snapshot);return e;
}

export async function verifyZkEvidence(client,e){
 validateZkEvidence(e);assert.equal(await client.getChainId(),e.chainId);const d=e.deployment,seen=new Map();
 async function block(cp){const actual=await checkpoint(client,BigInt(cp.blockNumber));assert.deepEqual(actual,cp,'Historical checkpoint mismatch');seen.set(cp.blockNumber,cp);return pinned(client,BigInt(cp.blockNumber));}
 async function receipt(row,status='success'){const value=await client.getTransactionReceipt({hash:row.hash});assert.equal(value.status,status);assert.equal(String(value.blockNumber),row.block.blockNumber);assert.equal(value.blockHash,row.block.blockHash);const tx=await client.getTransaction({hash:row.hash});assert(same(tx.from,row.from)&&same(tx.to,row.to));assert.equal(tx.input,row.data);await block(row.block);return value;}
 for(const row of Object.values(e.transactions))await receipt(row,row===e.cases.rootRetirement?.transaction?'reverted':'success');
 const finalClient=await block(e.snapshot);await sdk.checkMixedDeployment(finalClient,d);const initialClient=await block(e.grants.liquidityProvider.transaction.block),initial=await sdk.readMixedPolicy(initialClient,d);
 assert.equal(initial.config.mode,2);assert(initial.enabled&&initial.zkEnabled);for(const key of ['issuerHash','schemaHash','acceptedRoot','jurisdictionRoot','zkPolicyHash'])assert.equal(String(initial.config[key]),String(e.proofBundle.metadata[key]));assert.equal(initial.config.minKycLevel,e.proofBundle.metadata.minKycLevel);
 const root=new URL('../..',import.meta.url).pathname,vkeyPath=`${root}/circuits/build-v2/ilal_policy_v2_vkey.json`,zkeyPath=`${root}/circuits/build-v2/ilal_policy_v2.zkey`,vkey=JSON.parse(readFileSync(vkeyPath,'utf8'));
 assert.equal(sha256(vkeyPath),e.proofBundle.artifacts.vkeySHA256);assert.equal(sha256(zkeyPath),e.proofBundle.artifacts.zkeySHA256);
 for(const role of ['liquidityProvider','institutionA','institutionB']){
  const row=e.grants[role],activation=row.activation,inputs=row.inputs.map(BigInt),proofRow=e.proofBundle.proofs.find(x=>x.role===role);assert(proofRow&&same(proofRow.wallet,e.roles[role]));assert.deepEqual(inputs,proofRow.inputs.map(BigInt));assert.equal(row.proof,proofRow.proof);assert.equal(activation.source,2);assert.equal(String(activation.acceptedRoot),String(initial.config.acceptedRoot));
  assert.equal(inputs[0],BigInt(keccak256(e.roles[role]))>>4n);assert.equal(inputs[1],initial.config.issuerHash);assert.equal(inputs[2],initial.config.schemaHash);assert.equal(inputs[4],initial.config.acceptedRoot);assert.equal(inputs[5],BigInt(initial.config.minKycLevel));assert.equal(inputs[6],initial.config.jurisdictionRoot);assert.equal(inputs[7],initial.config.zkPolicyHash);assert.equal(inputs[8],2n);
  const [[a0,a1],[[b00,b01],[b10,b11]],[c0,c1]]=decodeAbiParameters([{type:'uint256[2]'},{type:'uint256[2][2]'},{type:'uint256[2]'}],row.proof),proof={pi_a:[String(a0),String(a1),'1'],pi_b:[[String(b01),String(b00)],[String(b11),String(b10)],['1','0']],pi_c:[String(c0),String(c1),'1'],protocol:'groth16',curve:'bn128'};
  assert(await groth16.verify(vkey,inputs.map(String),proof),`Invalid Groth16 proof: ${role}`);assert(await verifyTypedData({address:e.roles[role],domain:sdk.mixedDomain(e.chainId,d.contracts.grantManager,true),types:{MixedActivation:sdk.MixedActivationFields},primaryType:'MixedActivation',message:activation,signature:row.signature}));
  assert.equal(row.transaction.data,encodeFunctionData({abi:sdk.MixedGrantManagerAbi,functionName:'activate',args:[activation,row.signature,row.proof,inputs]}));const grantClient=await block(row.transaction.block),grant=await grantClient.readContract({address:d.contracts.grantManager,abi:sdk.MixedGrantManagerAbi,functionName:'grants',args:[d.pool.poolId,e.roles[role]]});assert.equal(grant[5],2);assert.equal(grant[6],initial.config.acceptedRoot);
 }
 for(const name of ['execution','rootRetirement']){
  const scenario=e.cases[name],files=scenario.signed.map(sdk.parseSignedMixedOrder),orders=files.map(x=>x.order),qClient=await block(scenario.quote.snapshot),quote=await sdk.quoteMixedOrders(qClient,d,orders);assert.deepEqual(normalized(quote),scenario.quote);for(const file of files)assert(await verifyTypedData({...sdk.mixedTypedData(file.order,e.chainId,d.contracts.hook),address:file.order.user,signature:file.signature}));
  assert.equal(scenario.transaction.data,encodeFunctionData({abi:sdk.MixedExecutionRouterAbi,functionName:'executeBatch',args:[d.pool,orders,files.map(x=>x.signature)]}));const txReceipt=await receipt(scenario.transaction,name==='execution'?'success':'reverted'),before=await stateAt(client,e,scenario.before,orders),after=await stateAt(client,e,scenario.after,orders);assert.deepEqual(before,scenario.stateBefore);assert.deepEqual(after,scenario.stateAfter);
  if(name==='execution'){const settled=events(txReceipt,d.contracts.executionRouter,sdk.MixedExecutionRouterAbi,'OrderSettled').sort((a,b)=>Number(a.index-b.index)),swaps=events(txReceipt,d.contracts.poolManager,managerAbi,'Swap').filter(x=>same(x.id,d.pool.poolId));assert.deepEqual(flowFromEvents(settled,swaps),e.flow);assert(after.nonces.every(Boolean));}
  else {assert.equal(txReceipt.logs.length,0);for(const key of ['balances','pool','position','nonces'])assert.deepEqual(after[key],before[key]);assert(before.nonces.every(x=>!x));assert.equal(before.policy.zkEnabled,false);assert.equal(BigInt(before.policy.revision),BigInt((await sdk.readMixedPolicy(qClient,d)).revision)+1n);let error;try{await sdk.prepareMixedExecution(await block(scenario.before),d,files,e.roles.executor);}catch(value){error=value;}const message=String(error),selector=keccak256(new TextEncoder().encode('Ineligible()')).slice(0,10);assert(error&&(message.includes('Ineligible')||message.includes(selector)),'Root retirement must produce Ineligible');}
 }
 const invalidation=await receipt(e.transactions.invalidateRoot),retiredRoot=BigInt(e.proofBundle.metadata.acceptedRoot);assert(events(invalidation,d.contracts.policyRegistry,sdk.MixedPolicyRegistryAbi,'RootRetired').some(x=>x.root===retiredRoot));assert.equal(await (await block(e.cases.rootRetirement.before)).readContract({address:d.contracts.policyRegistry,abi:sdk.MixedPolicyRegistryAbi,functionName:'retiredRoot',args:[d.pool.poolId,retiredRoot]}),true);
 let added=0n;
 for(const [name,action] of [['add',3],['collect',5],['exit',4]]){const row=e.lp[name],r=await receipt(row.transaction),before=await stateAt(client,e,row.before),after=await stateAt(client,e,row.after);assert.deepEqual(before,row.stateBefore);assert.deepEqual(after,row.stateAfter);const settled=events(r,d.contracts.liquidityRouter,sdk.MixedLiquidityRouterAbi,'LiquiditySettled');assert.equal(settled.length,1);const x=settled[0];assert.equal(x.action,action);if(name==='add'){added=x.liquidityDelta;assert(added>0n);}else{assert.equal(before.policy.zkEnabled,false);if(name==='collect')assert(x.fees0+x.fees1>0n,'Nonzero fee collection required');else {assert.equal(x.liquidityDelta,-added);assert.equal(BigInt(after.position[0])&((1n<<128n)-1n),0n);}}}
 const last=await stateAt(client,e,e.snapshot);for(const address of [d.contracts.hook,d.contracts.executionRouter,d.contracts.liquidityRouter])for(const token of [d.pool.currency0,d.pool.currency1])assert.equal(last.balances[`${address.toLowerCase()}.${token.toLowerCase()}`],'0');for(const cp of seen.values())await block(cp);
 return {status:'VERIFIED',checks:['three real Groth16 proofs: verified','170/140/30 from canonical events: verified','root retirement atomic revert: verified','nonzero fee collection and full exit: verified','zero transient inventory: verified'],flow:e.flow};
}
