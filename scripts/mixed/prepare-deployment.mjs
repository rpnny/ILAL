/** Generate exact ordered transactions only. Broadcasting is a separate explicit step. */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {artifact} from './local-deploy.mjs';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {getAddress,getContractAddress,getCreate2Address,toHex,encodeDeployData,encodeFunctionData,encodeAbiParameters,keccak256,zeroAddress}=require('viem');
export function validateDeploymentConfig(c){
 if(c.format!=='ilal-mixed-deploy-config-v1'||!['testnet','production'].includes(c.classification)||!Number.isSafeInteger(c.chainId)||c.chainId<=0)throw new Error('Version / chain / classification');
 for(const key of ['deployer','admin','poolManager','token0','token1','verifierAdapter','feed0','feed1','sequencerFeed'])getAddress(c[key]);
 if(BigInt(c.token0)>=BigInt(c.token1)||c.token0===zeroAddress||c.feed0.toLowerCase()===c.feed1.toLowerCase())throw new Error('Token/feed binding');
 if(!Number.isSafeInteger(c.startNonce)||c.startNonce<0||!Number.isInteger(c.initialTick)||c.initialTick!==0)throw new Error('Explicit nonce / initial parity price');
 for(const key of ['heartbeat0','heartbeat1','usdDeviationBps','pairDeviationBps','poolOracleDeviationBps','sequencerGracePeriod'])if(!Number.isSafeInteger(c[key])||c[key]<0)throw new Error(`Explicit threshold ${key}`);
 if(!c.heartbeat0||!c.heartbeat1||c.poolOracleDeviationBps<1||c.poolOracleDeviationBps>100||c.usdDeviationBps>10000||c.pairDeviationBps>10000||c.lowerTick!==-100||c.upperTick!==100)throw new Error('Threshold range');
 if(typeof c.sequencerRequired!=='boolean'||c.sequencerRequired!==(c.sequencerFeed!==zeroAddress)||(c.sequencerRequired?c.sequencerGracePeriod===0:c.sequencerGracePeriod!==0))throw new Error('Explicit sequencer binding');
 if(!c.policy||!['CNF_ONLY','ZK_ONLY','EITHER','BOTH'].includes(c.mode))throw new Error('Explicit policy mode');
 if(c.mode==='EITHER'&&c.cnfSourceExplicitlyApproved!==true)throw new Error('EITHER requires explicit CNF source approval');
 if(c.classification==='production'){
  if(c.ceremony!=='reviewed-production'||c.sourceDirty!==false)throw new Error('Production rejects development ceremony / dirty source');
  for(const key of ['sourceCommit','sourceDigest','verifierAdapterCodeHash','poolManagerCodeHash','ceremonyTranscriptSHA256','zkeySHA256','vkeySHA256','independentAuditSHA256','issuerAcceptanceSHA256'])if(!new RegExp(key==='sourceCommit'?'^[0-9a-f]{40}$':'^(0x)?[0-9a-f]{64}$').test(c[key]??''))throw new Error(`Production evidence missing: ${key}`);
 }
 return c;
}
export function prepareDeployment(c){
 validateDeploymentConfig(c);const transactions=[];let nonce=c.startNonce;
 const deploy=(name,args)=>{const a=artifact(name);if((a.deployedBytecode.object.length-2)/2>24576)throw new Error(`EIP-170 ${name}`);const address=getContractAddress({from:c.deployer,nonce:BigInt(nonce)});transactions.push({label:`Deploy ${name}`,nonce:nonce++,chainId:c.chainId,from:c.deployer,to:null,value:'0',data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args}),expectedAddress:address});return address;};
 const call=(label,address,name,fn,args)=>transactions.push({label,nonce:nonce++,chainId:c.chainId,from:c.deployer,to:address,value:'0',data:encodeFunctionData({abi:artifact(name).abi,functionName:fn,args})});
 const referenceGuard=deploy('ChainlinkStablecoinOracleGuard',[c.feed0,c.feed1,BigInt(c.heartbeat0),BigInt(c.heartbeat1),BigInt(c.usdDeviationBps),BigInt(c.pairDeviationBps),c.sequencerFeed,BigInt(c.sequencerGracePeriod)]);
 const oracle=deploy('MixedOracleGuard',[c.token0,c.token1,referenceGuard,BigInt(c.poolOracleDeviationBps)]);
 // Configure first, then explicitly transfer governance to the reviewed administrator.
 const policyRegistry=deploy('MixedPolicyRegistry',[c.deployer]);
 const grantManager=deploy('MixedGrantManager',[policyRegistry,c.verifierAdapter]);
 const executionRouter=deploy('MixedExecutionRouter',[c.poolManager]),liquidityRouter=deploy('MixedLiquidityRouter',[c.poolManager]);
 const factory=deploy('MixedHookFactory',[c.deployer]);
 const a=artifact('MixedHook'),code=encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args:[{manager:c.poolManager,oracle,eligibility:grantManager,executionRouter,liquidityRouter}]}),codeHash=keccak256(code);let salt,hook;
 for(let i=0n;;i++){salt=toHex(i,{size:32});hook=getCreate2Address({from:factory,salt,bytecodeHash:codeHash});if((BigInt(hook)&0x3fffn)===0xaa8n)break;}
 call('Deploy mined Hook using protocol factory',factory,'MixedHookFactory','deploy',[salt,code]);
 call('Bind execution Hook once',executionRouter,'MixedExecutionRouter','bindHook',[hook]);call('Bind liquidity Hook once',liquidityRouter,'MixedLiquidityRouter','bindHook',[hook]);
 const pool={currency0:c.token0,currency1:c.token1,fee:500,tickSpacing:10,hooks:hook};const poolId=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[c.token0,c.token1,500,10,hook]));
 const p={...c.policy,mode:['UNSET','CNF_ONLY','ZK_ONLY','EITHER','BOTH'].indexOf(c.mode)};for(const k of ['issuerHash','schemaHash','acceptedRoot','jurisdictionRoot','zkPolicyHash','maxGrantTTL'])p[k]=BigInt(p[k]);
 call('Configure initial policy',policyRegistry,'MixedPolicyRegistry','configure',[poolId,p]);call('Initialize pool at reviewed parity reference',c.poolManager,'PoolManager','initialize',[pool,1n<<96n]);
 if(c.admin.toLowerCase()!==c.deployer.toLowerCase())call('Transfer policy governance to reviewed admin',policyRegistry,'MixedPolicyRegistry','transferOwnership',[c.admin]);
 return {format:'ilal-mixed-deployment-plan-v1',status:'UNBROADCAST',configuration:c,predicted:{referenceGuard,oracle,policyRegistry,grantManager,executionRouter,liquidityRouter,factory,hook,poolId},transactions,requiredPreflight:['Recheck chain and starting nonce','Verify manager/verifier runtime hashes and deployed factory bytecode','Verify ordered token decimals and standard ERC20 behavior','Verify feeds correspond to the named ordered assets, heartbeat, sequencer and thresholds','Verify source revision/digest and ceremony/issuer/audit evidence','Simulate every transaction in order and inspect Hook flags 0x0aa8','Verify canonical bindings, roles, live policy and oracle after execution; do not migrate old signatures']};
}
export function sourceDigest(){const hash=createHash('sha256');const walk=p=>readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]);for(const p of walk('contracts/src')){hash.update(p);hash.update(readFileSync(p));}hash.update(readFileSync('contracts/foundry.toml'));return hash.digest('hex');}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const c=JSON.parse(readFileSync(process.argv[2],'utf8'));const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();if(c.sourceCommit&&c.sourceCommit!==revision)throw new Error('Source revision mismatch');if(c.sourceDigest&&c.sourceDigest!==sourceDigest())throw new Error('Source digest mismatch');
 if(c.classification==='production'&&execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw new Error('Production requires clean source');
 const plan=prepareDeployment(c);writeFileSync(process.argv[3]??'artifacts/mixed/deployment-plan.json',JSON.stringify(plan,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');console.log('Prepared reviewable transactions; nothing broadcast.');
}
