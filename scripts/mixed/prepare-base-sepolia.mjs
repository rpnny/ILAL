/** Build a fresh Base Sepolia Mixed plan from reviewed public test dependencies. Never signs or broadcasts. */
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {prepareDeployment,sourceDigest} from './prepare-deployment.mjs';

const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,erc20Abi,getAddress,http,keccak256,parseAbi,zeroAddress}=require('viem');
const [deployerArg,adminArg,rpc,configPath='artifacts/mixed/base-sepolia-config.json',planPath='artifacts/mixed/base-sepolia-plan.json']=process.argv.slice(2);
if(!deployerArg||!adminArg||!rpc)throw new Error('Usage: prepare-base-sepolia.mjs <deployer> <admin> <rpc> [config.json] [plan.json]');

const deployer=getAddress(deployerArg),admin=getAddress(adminArg),client=createPublicClient({transport:http(rpc)});
if(await client.getChainId()!==84532)throw new Error('Base Sepolia chain 84532 required');
const addresses={
 poolManager:getAddress('0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408'),
 token0:getAddress('0x036CbD53842c5426634e7929541eC2318f3dCF7e'),
 token1:getAddress('0xC4946fEC334f4B9350dF08E311261e4361B7c72C'),
 verifierAdapter:getAddress('0xaa204E50309e41d33f60D7d23D070B796AeF7330'),
 feed0:getAddress('0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165'),
 feed1:getAddress('0x3ec8593F930EA45ea58c968260e6e9FF53FC934f'),
 cnfIssuer:getAddress('0x4B3fAf8664eB85ED59059491925F763459E72386')
};
const feedAbi=parseAbi(['function description() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
const issuerAbi=parseAbi(['function schemaUID() view returns(bytes32)']);
const [decimals0,decimals1,symbol0,symbol1,description0,description1,round0,round1,credentialType,poolManagerCode,verifierAdapterCode]=await Promise.all([
 client.readContract({address:addresses.token0,abi:erc20Abi,functionName:'decimals'}),client.readContract({address:addresses.token1,abi:erc20Abi,functionName:'decimals'}),
 client.readContract({address:addresses.token0,abi:erc20Abi,functionName:'symbol'}),client.readContract({address:addresses.token1,abi:erc20Abi,functionName:'symbol'}),
 client.readContract({address:addresses.feed0,abi:feedAbi,functionName:'description'}),client.readContract({address:addresses.feed1,abi:feedAbi,functionName:'description'}),
 client.readContract({address:addresses.feed0,abi:feedAbi,functionName:'latestRoundData'}),client.readContract({address:addresses.feed1,abi:feedAbi,functionName:'latestRoundData'}),
 client.readContract({address:addresses.cnfIssuer,abi:issuerAbi,functionName:'schemaUID'}),client.getCode({address:addresses.poolManager}),client.getCode({address:addresses.verifierAdapter})
]);
if(decimals0!==6||decimals1!==6||symbol0!=='USDC'||symbol1!=='hUSDT')throw new Error('Reviewed test asset binding changed');
if(description0!=='USDC / USD'||description1!=='USDT / USD')throw new Error('Reviewed feed binding changed');
const now=(await client.getBlock()).timestamp;for(const [name,round] of [['USDC',round0],['USDT',round1]])if(round[1]<=0n||round[3]===0n||round[3]+86400n<now||round[4]<round[0])throw new Error(`${name} feed is unhealthy or stale`);
if(!poolManagerCode||poolManagerCode==='0x'||!verifierAdapterCode||verifierAdapterCode==='0x')throw new Error('Reviewed external contract missing');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceDirty=Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim());
const config={format:'ilal-mixed-deploy-config-v1',classification:'testnet',chainId:84532,deployer,admin,poolManager:addresses.poolManager,token0:addresses.token0,token1:addresses.token1,verifierAdapter:addresses.verifierAdapter,feed0:addresses.feed0,feed1:addresses.feed1,sequencerFeed:zeroAddress,startNonce:await client.getTransactionCount({address:deployer,blockTag:'pending'}),initialTick:0,heartbeat0:86400,heartbeat1:86400,usdDeviationBps:100,pairDeviationBps:100,poolOracleDeviationBps:100,sequencerGracePeriod:0,sequencerRequired:false,lowerTick:-100,upperTick:100,mode:'CNF_ONLY',ceremony:'unsafe-development',sourceCommit,sourceDigest:sourceDigest(),sourceDirty,poolManagerCodeHash:keccak256(poolManagerCode),verifierAdapterCodeHash:keccak256(verifierAdapterCode),policy:{cnfIssuer:addresses.cnfIssuer,credentialType,issuerHash:'0',schemaHash:'0',acceptedRoot:'0',jurisdictionRoot:'0',zkPolicyHash:'0',minKycLevel:0,maxGrantTTL:'86400'}};
const plan=prepareDeployment(config),json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
for(const path of [configPath,planPath])mkdirSync(dirname(resolve(path)),{recursive:true});writeFileSync(configPath,json(config));writeFileSync(planPath,json(plan));
console.log(`Prepared Base Sepolia config and ${plan.transactions.length} reviewed transactions; nothing broadcast. hUSDT is an ILAL test representation, not official USDT.`);
