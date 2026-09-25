/** Ephemeral Anvil fixture. Deliberately refuses non-loopback RPC and non-31337 chains. */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,createWalletClient,http,encodeDeployData,getCreate2Address,keccak256,toHex,encodeAbiParameters,zeroAddress}=require('viem');
const {privateKeyToAccount}=require('viem/accounts'),{foundry}=require('viem/chains');
const root=resolve(new URL('../..',import.meta.url).pathname);
export function artifact(name){return JSON.parse(readFileSync(`${root}/contracts/out/${name}.sol/${name}.json`,'utf8'));}
export async function deployLocal(rpc='http://127.0.0.1:8547') {
 const url=new URL(rpc);if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Local RPC only');
 const client=createPublicClient({chain:foundry,transport:http(rpc)});if(await client.getChainId()!==31337)throw new Error('Local chain 31337 only');
 // Public deterministic TEST account; never used outside this ephemeral chain.
 const account=privateKeyToAccount(toHex(0xA11CEn,{size:32}));
 await client.request({method:'anvil_setBalance',params:[account.address,toHex(10n**23n)]});
 const wallet=createWalletClient({account,chain:foundry,transport:http(rpc)});
 const send=async x=>{const hash=await wallet.writeContract(x);const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw new Error(`Reverted ${hash}`);return r;};
 const deploy=async(name,args=[])=>{const a=artifact(name);const hash=await wallet.deployContract({abi:a.abi,bytecode:a.bytecode.object,args});const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success')throw new Error(`Deploy ${name}`);return r.contractAddress;};
 const poolManager=await deploy('PoolManager',[account.address]);
 const tokens=[await deploy('MockERC20',['Mixed USD A','mUSDA',6]),await deploy('MockERC20',['Mixed USD B','mUSDB',6])].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);
 const referenceGuard=await deploy('MockStablecoinOracleGuard');
 const oracle=await deploy('MixedOracleGuard',[...tokens,referenceGuard,100n]);
 const policyRegistry=await deploy('MixedPolicyRegistry',[account.address]);
 const verifier=await deploy('ILALPolicyVerifierV2');const adapter=await deploy('Groth16VerifierAdapterV2',[verifier]);
 const grantManager=await deploy('MixedGrantManager',[policyRegistry,adapter]);
 const executionRouter=await deploy('MixedExecutionRouter',[poolManager]);const liquidityRouter=await deploy('MixedLiquidityRouter',[poolManager]);
 const factory=await deploy('MixedLocalFactory');const h=artifact('MixedHook');
 const code=encodeDeployData({abi:h.abi,bytecode:h.bytecode.object,args:[{manager:poolManager,oracle,eligibility:grantManager,executionRouter,liquidityRouter}]});
 let salt,hook;for(let i=0n;;i++){salt=toHex(i,{size:32});hook=getCreate2Address({from:factory,salt,bytecodeHash:keccak256(code)});if((BigInt(hook)&0x3fffn)===0xaa8n)break;}
 await send({address:factory,abi:artifact('MixedLocalFactory').abi,functionName:'deploy',args:[salt,code]});
 for(const [name,address] of [['MixedExecutionRouter',executionRouter],['MixedLiquidityRouter',liquidityRouter]])await send({address,abi:artifact(name).abi,functionName:'bindHook',args:[hook]});
 const pool={currency0:tokens[0],currency1:tokens[1],fee:500,tickSpacing:10,hooks:hook};
 const poolId=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[...tokens,500,10,hook]));
 await send({address:poolManager,abi:artifact('PoolManager').abi,functionName:'initialize',args:[pool,1n<<96n]});
 const cnf=await deploy('MockCNFIssuer');
 const fixture=JSON.parse(readFileSync(`${root}/artifacts/mixed/proofs/fixture.json`,'utf8'));const p=fixture.proofs[0].inputs.map(BigInt);
 const credentialType=await client.readContract({address:cnf,abi:artifact('MockCNFIssuer').abi,functionName:'defaultCredentialType'});
 const policy={mode:4,cnfIssuer:cnf,credentialType,issuerHash:p[1],schemaHash:p[2],acceptedRoot:p[4],jurisdictionRoot:p[6],zkPolicyHash:p[7],minKycLevel:Number(p[5]),maxGrantTTL:3600n};
 await send({address:policyRegistry,abi:artifact('MixedPolicyRegistry').abi,functionName:'configure',args:[poolId,policy]});
 for(const row of fixture.proofs){await client.request({method:'anvil_setBalance',params:[row.wallet,toHex(10n**23n)]});await send({address:cnf,abi:artifact('MockCNFIssuer').abi,functionName:'setValid',args:[row.wallet,true]});for(const token of tokens)await send({address:token,abi:artifact('MockERC20').abi,functionName:'mint',args:[row.wallet,10n**18n]});}
 const contracts={poolManager,hook,executionRouter,liquidityRouter,oracle,grantManager,policyRegistry};const codeHashes={};for(const [k,address] of Object.entries(contracts))codeHashes[k]=keccak256(await client.getCode({address}));
 const d={format:'ilal-mixed-deployment-v1',chainId:31337,classification:'local-development',ceremony:'unsafe-development',contracts,pool:{...pool,poolId},codeHashes,local:{cnf,referenceGuard,verifier,adapter,factory,admin:account.address,policy},sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDirty:true};
 mkdirSync(`${root}/artifacts/mixed`,{recursive:true});writeFileSync(`${root}/artifacts/mixed/local-deployment.json`,JSON.stringify(d,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
 return {client,wallet,send,deployment:d,fixture};
}
if(process.argv[1]===new URL(import.meta.url).pathname){await deployLocal(process.argv[2]);console.log('Created ephemeral local fixture; no public-network deployment.');}
