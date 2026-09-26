/** Static validation plus optional read-only receipt, nonce and zero-inventory checks. */
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {validatePilotEvidence} from './model.mjs';
import * as sdk from '../../sdk/dist/index.js';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));const {createPublicClient,http,erc20Abi}=require('viem');
const [evidencePath,rpc]=process.argv.slice(2);if(!evidencePath)throw new Error('Usage: verify-evidence.mjs evidence.json [explicit-rpc]');
const evidence=validatePilotEvidence(JSON.parse(readFileSync(evidencePath,'utf8')));
if(rpc){
 const client=createPublicClient({transport:http(rpc)});if(await client.getChainId()!==evidence.chainId)throw new Error('Evidence chain mismatch');
 for(const [label,hash] of Object.entries(evidence.transactions)){const receipt=await client.getTransactionReceipt({hash});if(receipt.status!=='success')throw new Error(`Failed evidence receipt: ${label}`);}
 const d={format:'ilal-mixed-deployment-v1',chainId:evidence.chainId,classification:evidence.chainId===31337?'local-development':'testnet',ceremony:'unsafe-development',contracts:evidence.deployment.contracts,pool:evidence.deployment.pool};await sdk.checkMixedDeployment(client,d);
 for(const [contractName,address] of Object.entries({hook:d.contracts.hook,executionRouter:d.contracts.executionRouter,liquidityRouter:d.contracts.liquidityRouter}))for(const [assetName,asset] of Object.entries(evidence.assets)){const balance=await client.readContract({address:asset.address,abi:erc20Abi,functionName:'balanceOf',args:[address]});if(balance!==0n)throw new Error(`${contractName}.${assetName} retains assets`);}
 for(const [index,nonce] of evidence.execution.nonces.entries()){const user=index===0?evidence.roles.institutionA:evidence.roles.institutionB;const used=await client.readContract({address:d.contracts.hook,abi:sdk.MixedHookAbi,functionName:'nonceUsed',args:[user,0,nonce]});if(!used)throw new Error('Executed nonce is not consumed');}
}
console.log(`Issuer pilot evidence passed: ${evidence.flow.grossInstitutionalFlow}/${evidence.flow.internallyMatchedFlow}/${evidence.flow.actualAmmInput}.`);
