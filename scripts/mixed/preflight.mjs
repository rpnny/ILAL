/** Read-only post-deployment / migration preflight. Never signs or sends transactions. */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {validateDeploymentConfig,sourceDigest} from './prepare-deployment.mjs';
import {artifact} from './local-deploy.mjs';
import {checkMixedDeployment,readMixedPolicy,readMixedMarket,mixedJSON,MixedPolicyRegistryAbi,MixedOracleGuardAbi} from '../../sdk/dist/index.js';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));const {createPublicClient,http,keccak256}=require('viem');
const [manifestPath,configPath,rpc]=process.argv.slice(2);if(!rpc)throw new Error('Usage: preflight.mjs manifest.json deployment-config.json explicit-rpc');
const d=JSON.parse(readFileSync(manifestPath,'utf8')),c=validateDeploymentConfig(JSON.parse(readFileSync(configPath,'utf8'))),client=createPublicClient({transport:http(rpc)});
if(d.chainId!==c.chainId||d.classification!==c.classification||d.ceremony!==c.ceremony)throw new Error('Manifest/config identity mismatch');
if(c.sourceDigest&&c.sourceDigest!==sourceDigest())throw new Error('Source changed');
await checkMixedDeployment(client,d);if((BigInt(d.contracts.hook)&0x3fffn)!==0xaa8n)throw new Error('Hook flags');
const referenceGuard=await client.readContract({address:d.contracts.oracle,abi:MixedOracleGuardAbi,functionName:'referenceGuard'});
for(const [fn,value] of Object.entries({feed0:c.feed0,feed1:c.feed1,maxAge0:c.heartbeat0,maxAge1:c.heartbeat1,maxUsdDeviationBps:c.usdDeviationBps,maxPairDeviationBps:c.pairDeviationBps,sequencerUptimeFeed:c.sequencerFeed,sequencerGracePeriod:c.sequencerGracePeriod})){
 const actual=await client.readContract({address:referenceGuard,abi:artifact('ChainlinkStablecoinOracleGuard').abi,functionName:fn});if(String(actual).toLowerCase()!==String(value).toLowerCase())throw new Error(`Oracle ${fn}`);
}
const deviation=await client.readContract({address:d.contracts.oracle,abi:MixedOracleGuardAbi,functionName:'maxPoolOracleDeviationBps'});if(deviation!==BigInt(c.poolOracleDeviationBps))throw new Error('Pool/oracle deviation');
const owner=await client.readContract({address:d.contracts.policyRegistry,abi:MixedPolicyRegistryAbi,functionName:'owner'});if(owner.toLowerCase()!==c.admin.toLowerCase())throw new Error('Governance role mismatch');
const policy=await readMixedPolicy(client,d);if(!policy.enabled||policy.config.mode!==['UNSET','CNF_ONLY','ZK_ONLY','EITHER','BOTH'].indexOf(c.mode))throw new Error('Policy mode disabled/mismatched');
for(const [k,v] of Object.entries(c.policy))if(String(policy.config[k]).toLowerCase()!==String(v).toLowerCase())throw new Error(`Policy ${k}`);
const boundVerifier=await client.readContract({address:d.contracts.grantManager,abi:artifact('MixedGrantManager').abi,functionName:'verifier'});if(boundVerifier.toLowerCase()!==c.verifierAdapter.toLowerCase())throw new Error('Verifier binding');
for(const [name,address] of Object.entries(d.infrastructure??{})){const expected=d.infrastructureCodeHashes?.[name];if(!expected||keccak256(await client.getCode({address}))!==expected)throw new Error(`${name} manifest runtime hash mismatch`);}
for(const [address,hash,label] of [[c.poolManager,c.poolManagerCodeHash,'PoolManager'],[c.verifierAdapter,c.verifierAdapterCodeHash,'verifier adapter']])if(hash&&keccak256(await client.getCode({address}))!==hash)throw new Error(`${label} runtime hash mismatch`);
const market=await readMixedMarket(client,d);if(!market.healthy)throw new Error(`Oracle fails closed: ${market.error}`);
const report={status:'READ_ONLY_CHECKS_PASSED',chainId:d.chainId,blockNumber:await client.getBlockNumber(),referenceGuard,owner,policy,market,externalGates:'Code hashes and supplied attestations do not replace independent audit, real issuer acceptance, ceremony review or deployment authorization.'};
writeFileSync('artifacts/mixed/preflight.json',mixedJSON(report)+'\n');console.log('Read-only preflight passed; nothing broadcast.');
