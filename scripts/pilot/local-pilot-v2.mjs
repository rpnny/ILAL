/** Reproducible issuer pilot. Refuses every non-loopback RPC and writes reviewable evidence. */
import {lifecycleV2} from './lifecycle-v2.mjs';
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


deployment.pilot={roles,assets:{issuerStablecoin:{...config.assets.issuerStablecoin,address:assetA.address,controller:roles.issuer},settlementCash:{...config.assets.settlementCash,address:assetB.address,controller:roles.settlementAssetOperator}},cnfIssuer:cnf.address};
// Simulate a crash after persisting signed bytes but before broadcasting.
const beforeInterrupt=await client.getBlockNumber({cacheTime:0});
await assert.rejects(()=>lifecycleV2({client,wallets,manifest:deployment,journalPath:'artifacts/pilot/local-v2-journal.json',outputPath:'artifacts/pilot/local-evidence-v2.json',localOracle:feed0.address,onSigned:async()=>{throw new Error('SIMULATED_INTERRUPT');}}),/SIMULATED_INTERRUPT/);
assert.equal(await client.getBlockNumber({cacheTime:0}),beforeInterrupt);
console.log(await lifecycleV2({client,wallets,manifest:deployment,journalPath:'artifacts/pilot/local-v2-journal.json',outputPath:'artifacts/pilot/local-evidence-v2.json',localOracle:feed0.address}));

// A completed journal must replay read-only and produce the same evidence.
const completedBlock=await client.getBlockNumber({cacheTime:0});
await lifecycleV2({client,wallets,manifest:deployment,journalPath:'artifacts/pilot/local-v2-journal.json',outputPath:'artifacts/pilot/local-evidence-v2.json',localOracle:feed0.address});
assert.equal(await client.getBlockNumber({cacheTime:0}),completedBlock,'Resume broadcast duplicate transaction');
