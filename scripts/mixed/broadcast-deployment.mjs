/** Explicit Mixed deployment broadcaster. Requires a reviewed plan and an explicit signer. */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {configureSignerOptions,createExecutionClients} from '../../cli/dist/signer.js';
import {prepareDeployment,sourceDigest,validateDeploymentConfig} from './prepare-deployment.mjs';

const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {defineChain,getAddress,http,createPublicClient,keccak256}=require('viem');

function usage(){throw new Error('Usage: broadcast-deployment.mjs <plan.json> <rpc> <manifest.json> [--keystore path] [--password-file path] [--rpc-account address] [--unsafe-private-key]');}
function options(args){const o={};for(let i=0;i<args.length;i++){const k=args[i];if(k==='--unsafe-private-key')o.unsafePrivateKey=true;else if(['--keystore','--password-file','--rpc-account'].includes(k)){if(!args[i+1])usage();o[k.slice(2).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=args[++i];}else usage();}return o;}
const [planPath,rpc,manifestPath,...rest]=process.argv.slice(2);if(!planPath||!rpc||!manifestPath)usage();
const plan=JSON.parse(readFileSync(planPath,'utf8')),c=validateDeploymentConfig(plan.configuration);
if(plan.format!=='ilal-mixed-deployment-plan-v1'||plan.status!=='UNBROADCAST'||!Array.isArray(plan.transactions))throw new Error('Unsupported deployment plan');
const stringify=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
if(stringify(prepareDeployment(c))!==stringify(plan))throw new Error('Plan does not match its configuration');
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty=Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim());
if(c.sourceCommit&&c.sourceCommit!==revision)throw new Error('Source revision mismatch');
if(c.sourceDigest&&c.sourceDigest!==sourceDigest())throw new Error('Source digest mismatch');
if(c.classification==='production'&&dirty)throw new Error('Production requires clean source');
const signerOptions=options(rest);configureSignerOptions(signerOptions);
const chain=defineChain({id:c.chainId,name:`ILAL deployment ${c.chainId}`,nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}},testnet:c.classification!=='production'});
const clients=await createExecutionClients({chain,rpc});const {publicClient,walletClient,account}=clients;
if(getAddress(account.address)!==getAddress(c.deployer))throw new Error(`Signer/deployer mismatch: ${account.address}`);
if(await publicClient.getChainId()!==c.chainId)throw new Error('RPC chain mismatch');

const planDigest=createHash('sha256').update(readFileSync(planPath)).digest('hex');
const journalPath=`${manifestPath}.journal`;
let journal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):{format:'ilal-mixed-deployment-journal-v1',planDigest,receipts:[]};
if(journal.planDigest!==planDigest||!Array.isArray(journal.receipts))throw new Error('Deployment journal does not match plan');
for(const row of journal.receipts){const receipt=await publicClient.getTransactionReceipt({hash:row.transactionHash});if(receipt.status!=='success'||receipt.blockHash!==row.blockHash)throw new Error(`Journal receipt is not canonical: ${row.transactionHash}`);}
const next=await publicClient.getTransactionCount({address:account.address,blockTag:'pending'}),expected=c.startNonce+journal.receipts.length;
if(next!==expected)throw new Error(`Nonce changed: plan expects ${expected}, RPC reports ${next}`);

for(let i=journal.receipts.length;i<plan.transactions.length;i++){
 const tx=plan.transactions[i];
 if(tx.chainId!==c.chainId||getAddress(tx.from)!==getAddress(c.deployer)||tx.nonce!==c.startNonce+i)throw new Error(`Invalid transaction ${i}`);
 const request={account,chain,to:tx.to?getAddress(tx.to):undefined,data:tx.data,value:BigInt(tx.value),nonce:tx.nonce};
 await publicClient.estimateGas(request);
 const hash=await walletClient.sendTransaction(request),receipt=await publicClient.waitForTransactionReceipt({hash});
 if(receipt.status!=='success')throw new Error(`Transaction reverted: ${hash}`);
 if(tx.expectedAddress&&getAddress(receipt.contractAddress??'0x0000000000000000000000000000000000000000')!==getAddress(tx.expectedAddress))throw new Error(`Deployment address mismatch: ${tx.label}`);
 journal.receipts.push({label:tx.label,nonce:tx.nonce,transactionHash:hash,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,contractAddress:receipt.contractAddress??null,gasUsed:receipt.gasUsed.toString()});
 mkdirSync(dirname(resolve(journalPath)),{recursive:true});writeFileSync(journalPath,JSON.stringify(journal,null,2)+'\n',{mode:0o600});
}

const contracts={poolManager:c.poolManager,hook:plan.predicted.hook,executionRouter:plan.predicted.executionRouter,liquidityRouter:plan.predicted.liquidityRouter,oracle:plan.predicted.oracle,grantManager:plan.predicted.grantManager,policyRegistry:plan.predicted.policyRegistry};
const codeHashes={};for(const [name,address] of Object.entries(contracts)){const code=await publicClient.getCode({address});if(!code||code==='0x')throw new Error(`Missing deployed code: ${name}`);codeHashes[name]=keccak256(code);}
const infrastructure={referenceGuard:plan.predicted.referenceGuard,factory:plan.predicted.factory,verifierAdapter:c.verifierAdapter};
const infrastructureCodeHashes={};for(const [name,address] of Object.entries(infrastructure)){const code=await publicClient.getCode({address});if(!code||code==='0x')throw new Error(`Missing infrastructure code: ${name}`);infrastructureCodeHashes[name]=keccak256(code);}
const manifest={format:'ilal-mixed-deployment-v1',chainId:c.chainId,classification:c.classification,ceremony:c.ceremony,sourceRevision:revision,sourceDigest:sourceDigest(),sourceDirty:dirty,deployer:c.deployer,admin:c.admin,contracts,pool:{currency0:c.token0,currency1:c.token1,fee:500,tickSpacing:10,hooks:plan.predicted.hook,poolId:plan.predicted.poolId},codeHashes,infrastructure,infrastructureCodeHashes,configurationDigest:planDigest,transactions:journal.receipts};
mkdirSync(dirname(resolve(manifestPath)),{recursive:true});writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(`Deployment complete: ${manifestPath}`);
