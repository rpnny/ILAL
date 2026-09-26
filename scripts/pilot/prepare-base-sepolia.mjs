/** Prepare a dedicated issuer-pilot sandbox deployment. It never signs or broadcasts. */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {artifact} from '../mixed/local-deploy.mjs';
import {prepareDeployment,sourceDigest} from '../mixed/prepare-deployment.mjs';
import {validatePilotConfig} from './model.mjs';

const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,getAddress,getContractAddress,http,keccak256,encodeDeployData,parseAbi,zeroAddress}=require('viem');

export function preparePilotDeployment(pilotConfig,dependencies){
 const pilot=validatePilotConfig(pilotConfig);if(pilot.chainId!==84532)throw new Error('Base Sepolia chain 84532 required');
 const d={...dependencies};for(const key of ['poolManager','verifierAdapter','feedIssuerAsset','feedSettlementCash'])d[key]=getAddress(d[key]);
 if(!Number.isSafeInteger(d.startNonce)||d.startNonce<0)throw new Error('Pilot deployment nonce');
 let nonce=d.startNonce;const deploy=(label,name,args)=>{const a=artifact(name),address=getContractAddress({from:pilot.roles.deployer,nonce:BigInt(nonce)});const tx={label,nonce:nonce++,chainId:pilot.chainId,from:pilot.roles.deployer,to:null,value:'0',data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args}),expectedAddress:address};return {address,tx};};
 const issuerAsset=deploy('Deploy issuer-controlled Asset A','PilotAsset',[pilot.assets.issuerStablecoin.name,pilot.assets.issuerStablecoin.symbol,6,pilot.roles.issuer]);
 const settlementCash=deploy('Deploy sandbox settlement Asset B','PilotAsset',[pilot.assets.settlementCash.name,pilot.assets.settlementCash.symbol,6,pilot.roles.settlementAssetOperator]);
 const credentialType=keccak256(new TextEncoder().encode('ilal.pilot.issuer-eligible'));
 const cnfIssuer=deploy('Deploy issuer-controlled CNF sandbox','PilotCNFIssuer',[pilot.roles.issuer,credentialType]);
 const assets=[{address:issuerAsset.address,feed:d.feedIssuerAsset},{address:settlementCash.address,feed:d.feedSettlementCash}].sort((a,b)=>BigInt(a.address)<BigInt(b.address)?-1:1);
 const protocolConfig={format:'ilal-mixed-deploy-config-v1',classification:'testnet',chainId:84532,deployer:pilot.roles.deployer,admin:pilot.roles.issuer,poolManager:d.poolManager,token0:assets[0].address,token1:assets[1].address,verifierAdapter:d.verifierAdapter,feed0:assets[0].feed,feed1:assets[1].feed,sequencerFeed:zeroAddress,startNonce:nonce,initialTick:0,heartbeat0:86400,heartbeat1:86400,usdDeviationBps:100,pairDeviationBps:100,poolOracleDeviationBps:100,sequencerGracePeriod:0,sequencerRequired:false,lowerTick:-100,upperTick:100,mode:'CNF_ONLY',ceremony:'unsafe-development',sourceCommit:d.sourceCommit,sourceDigest:d.sourceDigest,sourceDirty:d.sourceDirty,poolManagerCodeHash:d.poolManagerCodeHash,verifierAdapterCodeHash:d.verifierAdapterCodeHash,policy:{cnfIssuer:cnfIssuer.address,credentialType,issuerHash:'0',schemaHash:'0',acceptedRoot:'0',jurisdictionRoot:'0',zkPolicyHash:'0',minKycLevel:0,maxGrantTTL:String(pilot.policy.grantTtlSeconds)}};
 const protocolPlan=prepareDeployment(protocolConfig),transactions=[issuerAsset.tx,settlementCash.tx,cnfIssuer.tx,...protocolPlan.transactions];
 return {format:'ilal-issuer-pilot-deployment-plan-v1',status:'UNBROADCAST',pilotConfig:pilot,dependencies:d,protocolPlan,predicted:{issuerStablecoin:issuerAsset.address,settlementCash:settlementCash.address,cnfIssuer:cnfIssuer.address,...protocolPlan.predicted},transactions,operationalEvidence:{status:'not completed',reason:'Deployment is not a funded credential, grant, liquidity or execution rehearsal.'}};
}

if(process.argv[1]===new URL(import.meta.url).pathname){
 const [configPath,rpc,output='artifacts/pilot/base-sepolia-plan.json']=process.argv.slice(2);if(!configPath||!rpc)throw new Error('Usage: prepare-base-sepolia.mjs pilot-config.json explicit-rpc [plan.json]');
 const pilot=validatePilotConfig(JSON.parse(readFileSync(configPath,'utf8'))),client=createPublicClient({transport:http(rpc)});if(await client.getChainId()!==84532)throw new Error('Base Sepolia chain 84532 required');
 const addresses={poolManager:getAddress('0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408'),verifierAdapter:getAddress('0xaa204E50309e41d33f60D7d23D070B796AeF7330'),feedIssuerAsset:getAddress('0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165'),feedSettlementCash:getAddress('0x3ec8593F930EA45ea58c968260e6e9FF53FC934f')};
 const feedAbi=parseAbi(['function description() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
 const [poolCode,verifierCode,feedA,feedB,roundA,roundB]=await Promise.all([client.getCode({address:addresses.poolManager}),client.getCode({address:addresses.verifierAdapter}),client.readContract({address:addresses.feedIssuerAsset,abi:feedAbi,functionName:'description'}),client.readContract({address:addresses.feedSettlementCash,abi:feedAbi,functionName:'description'}),client.readContract({address:addresses.feedIssuerAsset,abi:feedAbi,functionName:'latestRoundData'}),client.readContract({address:addresses.feedSettlementCash,abi:feedAbi,functionName:'latestRoundData'})]);
 if(!poolCode||poolCode==='0x'||!verifierCode||verifierCode==='0x'||feedA!=='USDC / USD'||feedB!=='USDT / USD')throw new Error('Reviewed Base Sepolia dependencies changed');
 const now=(await client.getBlock()).timestamp;for(const round of [roundA,roundB])if(round[1]<=0n||round[3]===0n||round[3]+86400n<now||round[4]<round[0])throw new Error('Reference feed unhealthy or stale');
 const dependencies={...addresses,startNonce:await client.getTransactionCount({address:pilot.roles.deployer,blockTag:'pending'}),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDigest:sourceDigest(),sourceDirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()),poolManagerCodeHash:keccak256(poolCode),verifierAdapterCodeHash:keccak256(verifierCode)};
 const plan=preparePilotDeployment(pilot,dependencies);mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(plan,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n');console.log(`Prepared ${plan.transactions.length} issuer-pilot transactions; nothing broadcast.`);
}
