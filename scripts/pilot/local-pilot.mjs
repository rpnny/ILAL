/** Reproducible issuer pilot. Refuses every non-loopback RPC and writes reviewable evidence. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {artifact} from '../mixed/local-deploy.mjs';
import {validatePilotConfig,validatePilotEvidence} from './model.mjs';
import * as sdk from '../../sdk/dist/index.js';

const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,createWalletClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,encodeAbiParameters,erc20Abi,decodeEventLog}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');
const {foundry}=require('viem/chains');
const rpc=process.argv[2]??'http://127.0.0.1:8547';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(rpc).hostname))throw new Error('Issuer pilot is local-only');
const client=createPublicClient({chain:foundry,transport:http(rpc)});
assert.equal(await client.getChainId(),31337);

const keys={deployer:0xD3E10n,issuer:0x155E2n,settlementAssetOperator:0xCA5A0n,liquidityProvider:0x1F00n,institutionA:0xA100n,institutionB:0xB200n,executor:0xE300n};
const wallets=Object.fromEntries(Object.entries(keys).map(([name,key])=>[name,createWalletClient({account:privateKeyToAccount(toHex(key,{size:32})),chain:foundry,transport:http(rpc)})]));
const roles=Object.fromEntries(Object.entries(wallets).map(([name,wallet])=>[name,wallet.account.address]));
for(const address of Object.values(roles))await client.request({method:'anvil_setBalance',params:[address,toHex(10n**23n)]});
const config=validatePilotConfig({format:'ilal-issuer-pilot-config-v1',chainId:31337,roles,assets:{issuerStablecoin:{name:'Issuer Pilot Stablecoin',symbol:'ipUSD',decimals:6,role:'issuer-stablecoin'},settlementCash:{name:'Sandbox Settlement Cash',symbol:'sUSD',decimals:6,role:'sandbox-settlement-cash'}},scenario:{issuerAssetInput:'100000000',settlementCashInput:'70000000',tickLower:-1000,tickUpper:1000,liquidityDelta:'100000000000000'},policy:{mode:'CNF_ONLY',grantTtlSeconds:3600}});

const receipt=async hash=>{const value=await client.waitForTransactionReceipt({hash});assert.equal(value.status,'success');return value;};
const deploy=async(name,args=[])=>{const a=artifact(name);const row=await receipt(await wallets.deployer.deployContract({abi:a.abi,bytecode:a.bytecode.object,args}));return {address:row.contractAddress,hash:row.transactionHash};};
const send=async(wallet,address,name,fn,args)=>receipt(await wallet.writeContract({address,abi:artifact(name).abi,functionName:fn,args}));
const transactions={};

const manager=await deploy('PoolManager',[roles.deployer]);transactions.deployPoolManager=manager.hash;
const assetA=await deploy('PilotAsset',[config.assets.issuerStablecoin.name,config.assets.issuerStablecoin.symbol,6,roles.issuer]);transactions.deployIssuerStablecoin=assetA.hash;
const assetB=await deploy('PilotAsset',[config.assets.settlementCash.name,config.assets.settlementCash.symbol,6,roles.settlementAssetOperator]);transactions.deploySettlementCash=assetB.hash;
const cnf=await deploy('PilotCNFIssuer',[roles.issuer,keccak256(new TextEncoder().encode('ilal.pilot.issuer-eligible'))]);transactions.deployCnfIssuer=cnf.hash;
const feed0=await deploy('MockChainlinkAggregator',[8,'Issuer Pilot Stablecoin / USD',100000000n]);
const feed1=await deploy('MockChainlinkAggregator',[8,'Sandbox Settlement Cash / USD',100000000n]);
const referenceGuard=await deploy('ChainlinkStablecoinOracleGuard',[feed0.address,feed1.address,604800n,604800n,100n,100n,'0x0000000000000000000000000000000000000000',0n]);
const ordered=[assetA.address,assetB.address].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
const oracle=await deploy('MixedOracleGuard',[ordered[0],ordered[1],referenceGuard.address,100n]);
const registry=await deploy('MixedPolicyRegistry',[roles.issuer]);
const verifier=await deploy('ILALPolicyVerifierV2');
const adapter=await deploy('Groth16VerifierAdapterV2',[verifier.address]);
const grantManager=await deploy('MixedGrantManager',[registry.address,adapter.address]);
const executionRouter=await deploy('MixedExecutionRouter',[manager.address]);
const liquidityRouter=await deploy('MixedLiquidityRouter',[manager.address]);
const factory=await deploy('MixedHookFactory',[roles.deployer]);
const hookArtifact=artifact('MixedHook');
const hookCode=encodeDeployData({abi:hookArtifact.abi,bytecode:hookArtifact.bytecode.object,args:[{manager:manager.address,oracle:oracle.address,eligibility:grantManager.address,executionRouter:executionRouter.address,liquidityRouter:liquidityRouter.address}]});
let salt,hook;for(let i=0n;;i++){salt=toHex(i,{size:32});hook=getCreate2Address({from:factory.address,salt,bytecodeHash:keccak256(hookCode)});if((BigInt(hook)&0x3fffn)===0xaa8n)break;}
transactions.deployHook=(await send(wallets.deployer,factory.address,'MixedHookFactory','deploy',[salt,hookCode])).transactionHash;
await send(wallets.deployer,executionRouter.address,'MixedExecutionRouter','bindHook',[hook]);
await send(wallets.deployer,liquidityRouter.address,'MixedLiquidityRouter','bindHook',[hook]);
const pool={currency0:ordered[0],currency1:ordered[1],fee:500,tickSpacing:10,hooks:hook};
const poolId=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[...ordered,500,10,hook]));
const policyConfig={mode:1,cnfIssuer:cnf.address,credentialType:await client.readContract({address:cnf.address,abi:artifact('PilotCNFIssuer').abi,functionName:'credentialType'}),issuerHash:0n,schemaHash:0n,acceptedRoot:0n,jurisdictionRoot:0n,zkPolicyHash:0n,minKycLevel:0,maxGrantTTL:BigInt(config.policy.grantTtlSeconds)};
transactions.configurePolicy=(await send(wallets.issuer,registry.address,'MixedPolicyRegistry','configure',[poolId,policyConfig])).transactionHash;
transactions.initializePool=(await send(wallets.deployer,manager.address,'PoolManager','initialize',[pool,1n<<96n])).transactionHash;

const contracts={poolManager:manager.address,hook,executionRouter:executionRouter.address,liquidityRouter:liquidityRouter.address,oracle:oracle.address,grantManager:grantManager.address,policyRegistry:registry.address};
const codeHashes={};for(const [name,address] of Object.entries(contracts))codeHashes[name]=keccak256(await client.getCode({address}));
const deployment={format:'ilal-mixed-deployment-v1',chainId:31337,classification:'local-development',ceremony:'unsafe-development',contracts,pool:{...pool,poolId},codeHashes,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty:true};
await sdk.checkMixedDeployment(client,deployment);

const expiry=Number((await client.getBlock()).timestamp+30n*86400n);
for(const name of ['liquidityProvider','institutionA','institutionB'])transactions[`issue${name}`]=(await send(wallets.issuer,cnf.address,'PilotCNFIssuer','issue',[roles[name],expiry])).transactionHash;
transactions.mintIssuerAsset=(await send(wallets.issuer,assetA.address,'PilotAsset','mint',[roles.liquidityProvider,1000000000000000000n])).transactionHash;
await send(wallets.issuer,assetA.address,'PilotAsset','mint',[roles.institutionA,1000000000n]);
transactions.mintSettlementCash=(await send(wallets.settlementAssetOperator,assetB.address,'PilotAsset','mint',[roles.liquidityProvider,1000000000000000000n])).transactionHash;
await send(wallets.settlementAssetOperator,assetB.address,'PilotAsset','mint',[roles.institutionB,1000000000n]);
for(const name of ['liquidityProvider','institutionA','institutionB'])for(const token of ordered)for(const spender of [executionRouter.address,liquidityRouter.address])await receipt(await wallets[name].writeContract({address:token,abi:erc20Abi,functionName:'approve',args:[spender,(1n<<256n)-1n]}));

let serial=0n;const fresh=()=>toHex(++serial,{size:32});
async function activate(name){const p=await sdk.readMixedPolicy(client,deployment),block=await client.getBlock();const a={user:roles[name],poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,source:1,acceptedRoot:p.config.acceptedRoot,rootEpoch:p.rootEpoch,evidenceHash:keccak256(encodeAbiParameters([{type:'bytes'},{type:'uint256[]'}],['0x',[]])),deadline:block.timestamp+600n,nonce:fresh()};return receipt(await sdk.activateMixedGrant(client,wallets[name],deployment,a,'0x',[]));}
for(const name of ['liquidityProvider','institutionA','institutionB'])transactions[`grant${name}`]=(await activate(name)).transactionHash;
async function liquidity(action,delta){const p=await sdk.readMixedPolicy(client,deployment),block=await client.getBlock();return receipt(await sdk.modifyMixedLiquidity(client,wallets.liquidityProvider,deployment,{user:roles.liquidityProvider,poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,action,tickLower:-1000,tickUpper:1000,liquidityDelta:delta,userSalt:toHex(0n,{size:32}),amount0Limit:action===3?(1n<<127n)-1n:0n,amount1Limit:action===3?(1n<<127n)-1n:0n,deadline:block.timestamp+600n,nonce:fresh()}));}
transactions.addLiquidity=(await liquidity(3,100000000000000n)).transactionHash;
async function orders(){const p=await sdk.readMixedPolicy(client,deployment),block=await client.getBlock();const aIs0=assetA.address.toLowerCase()===ordered[0].toLowerCase();return [{user:roles.institutionA,poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,zeroForOne:aIs0,amountIn:100000000n,minAmountOut:0n,maxAmmInput:100000000n,minSqrtPriceX96:sdk.MIN_SQRT,maxSqrtPriceX96:sdk.MAX_SQRT,deadline:block.timestamp+7n*86400n,nonce:fresh()},{user:roles.institutionB,poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,zeroForOne:!aIs0,amountIn:70000000n,minAmountOut:0n,maxAmmInput:70000000n,minSqrtPriceX96:sdk.MIN_SQRT,maxSqrtPriceX96:sdk.MAX_SQRT,deadline:block.timestamp+7n*86400n,nonce:fresh()}];}
const staleOrders=await orders(),staleQuote=await sdk.quoteMixedOrders(client,deployment,staleOrders),staleSigned=await Promise.all([sdk.signMixedOrder(wallets.institutionA,deployment,staleOrders[0]),sdk.signMixedOrder(wallets.institutionB,deployment,staleOrders[1])]);
transactions.proposePolicyChange=(await send(wallets.issuer,registry.address,'MixedPolicyRegistry','configure',[poolId,{...policyConfig,maxGrantTTL:BigInt(config.policy.grantTtlSeconds+60)}])).transactionHash;
await client.request({method:'evm_increaseTime',params:[172801]});await client.request({method:'evm_mine',params:[]});
transactions.activatePolicyChange=(await send(wallets.issuer,registry.address,'MixedPolicyRegistry','activate',[poolId])).transactionHash;
const staleBalancesBefore=await Promise.all([assetA.address,assetB.address].flatMap(token=>[roles.institutionA,roles.institutionB].map(user=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[user]}))));
await assert.rejects(()=>sdk.executeMixedOrders(client,wallets.executor,deployment,staleSigned));
const staleBalancesAfter=await Promise.all([assetA.address,assetB.address].flatMap(token=>[roles.institutionA,roles.institutionB].map(user=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[user]}))));
const staleNonces=await Promise.all(staleOrders.map(o=>client.readContract({address:hook,abi:sdk.MixedHookAbi,functionName:'nonceUsed',args:[o.user,0,o.nonce]})));
assert.deepEqual(staleBalancesAfter,staleBalancesBefore);assert.deepEqual(staleNonces,[false,false]);

for(const name of ['liquidityProvider','institutionA','institutionB'])transactions[`regrant${name}`]=(await activate(name)).transactionHash;
const liveOrders=await orders(),quote=await sdk.quoteMixedOrders(client,deployment,liveOrders),signed=await Promise.all([sdk.signMixedOrder(wallets.institutionA,deployment,liveOrders[0]),sdk.signMixedOrder(wallets.institutionB,deployment,liveOrders[1])]);
const before=await Promise.all([assetA.address,assetB.address].flatMap(token=>[roles.institutionA,roles.institutionB].map(user=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[user]}))));
const execution=await sdk.executeMixedOrders(client,wallets.executor,deployment,signed);transactions.executeBatch=execution.transactionHash;
const events=execution.logs.flatMap(log=>{try{return [decodeEventLog({abi:sdk.MixedExecutionRouterAbi,...log})];}catch{return [];}}).filter(event=>event.eventName==='OrderSettled').sort((a,b)=>Number(a.args.index-b.args.index));
assert.equal(events.length,2);
const flow={grossInstitutionalFlow:liveOrders.reduce((sum,o)=>sum+o.amountIn,0n),internallyMatchedFlow:events.reduce((sum,event)=>sum+event.args.matchedInput,0n),unmatchedResidual:events.reduce((sum,event)=>sum+event.args.ammInput,0n),actualAmmInput:events.reduce((sum,event)=>sum+event.args.ammInput,0n)};
assert.deepEqual(flow,{grossInstitutionalFlow:170000000n,internallyMatchedFlow:140000000n,unmatchedResidual:30000000n,actualAmmInput:30000000n});
assert.deepEqual(events.map(event=>event.args.output),quote.allocations.map(allocation=>allocation.output));
const after=await Promise.all([assetA.address,assetB.address].flatMap(token=>[roles.institutionA,roles.institutionB].map(user=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[user]}))));

transactions.revokeInstitutionA=(await send(wallets.issuer,cnf.address,'PilotCNFIssuer','revoke',[roles.institutionA])).transactionHash;
const revokedOrders=await orders(),revokedBalancesBefore=await Promise.all([assetA.address,assetB.address].map(token=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[roles.institutionA]})));
await assert.rejects(()=>sdk.quoteMixedOrders(client,deployment,revokedOrders));
const revokedBalancesAfter=await Promise.all([assetA.address,assetB.address].map(token=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[roles.institutionA]})));
assert.deepEqual(revokedBalancesAfter,revokedBalancesBefore);
transactions.revokeLp=(await send(wallets.issuer,cnf.address,'PilotCNFIssuer','revoke',[roles.liquidityProvider])).transactionHash;
transactions.disablePolicy=(await send(wallets.issuer,registry.address,'MixedPolicyRegistry','disable',[poolId])).transactionHash;
transactions.breakOracle=(await send(wallets.deployer,feed0.address,'MockChainlinkAggregator','setShouldRevert',[true])).transactionHash;
transactions.exitLiquidity=(await liquidity(4,-50000000000000n)).transactionHash;
transactions.collectFees=(await liquidity(5,0n)).transactionHash;
transactions.exitRemainingLiquidity=(await liquidity(4,-50000000000000n)).transactionHash;

const inventory={};for(const [contractName,address] of Object.entries({hook,executionRouter:executionRouter.address,liquidityRouter:liquidityRouter.address}))for(const [assetName,addressToken] of Object.entries({issuerStablecoin:assetA.address,settlementCash:assetB.address}))inventory[`${contractName}.${assetName}`]=(await client.readContract({address:addressToken,abi:erc20Abi,functionName:'balanceOf',args:[address]})).toString();
const block=await client.getBlock();
const evidence={format:'ilal-issuer-pilot-evidence-v1',status:'PASSED',chainId:31337,snapshot:{blockNumber:block.number.toString(),blockHash:block.hash,timestamp:block.timestamp.toString()},roles,assets:{issuerStablecoin:{...config.assets.issuerStablecoin,address:assetA.address,controller:roles.issuer},settlementCash:{...config.assets.settlementCash,address:assetB.address,controller:roles.settlementAssetOperator}},deployment:{contracts,pool},policy:{mode:'CNF_ONLY',initialRevision:'1',executedRevision:'2'},flow:Object.fromEntries(Object.entries(flow).map(([key,value])=>[key,value.toString()])),quote:{snapshotBlock:quote.snapshot.blockNumber.toString(),commitment:quote.commitment,outputs:quote.allocations.map(a=>a.output.toString())},execution:{transactionHash:execution.transactionHash,outputs:events.map(event=>event.args.output.toString()),balancesBefore:before.map(String),balancesAfter:after.map(String),nonces:liveOrders.map(order=>order.nonce)},negativeTests:{quotePolicyChangeExecute:{passed:true,stateUnchanged:true,quotedRevision:staleOrders[0].policyRevision.toString(),activeRevision:'2',noncesUnconsumed:staleNonces.every(value=>!value),quoteCommitment:staleQuote.commitment},revokedInstitutionRejected:{passed:true,stateUnchanged:true,method:'forced-revert quote after CNF revocation'}},lpSafety:{principle:'Eligibility controls new risk-taking actions, not withdrawal of existing assets.',exitAfterPolicyFailure:true,collectAfterPolicyFailure:true,policyDisabled:true,lpCredentialRevoked:true,oracleFailureInduced:true},inventory,transactions};
validatePilotEvidence(evidence);
mkdirSync('artifacts/pilot',{recursive:true});writeFileSync('artifacts/pilot/local-config.json',sdk.mixedJSON(config)+'\n');writeFileSync('artifacts/pilot/local-deployment.json',sdk.mixedJSON(deployment)+'\n');writeFileSync('artifacts/pilot/local-evidence.json',sdk.mixedJSON(evidence)+'\n');
console.log('Issuer pilot passed: gross 170, internally matched 140, public AMM residual 30; LP exit and collect survived policy failure.');
