/** Independently verify, publish and bind ZK_ONLY evidence to its candidate manifest. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {FORMAT,validateZkEvidence} from './zk-evidence.mjs';
const [manifestPath,sourcePath,publishedPath,rpc]=process.argv.slice(2);if(!rpc)throw new Error('Usage: record-zk-evidence.mjs manifest.json source-evidence.json published-evidence.json rpc');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),raw=readFileSync(sourcePath),evidence=JSON.parse(raw);validateZkEvidence(evidence);if(evidence.format!==FORMAT||manifest.pilot?.policy?.mode!=='ZK_ONLY')throw new Error('ZK evidence/candidate mode mismatch');
if(manifest.chainId!==evidence.chainId||manifest.pool.poolId.toLowerCase()!==evidence.deployment.pool.poolId.toLowerCase())throw new Error('Evidence/manifest identity mismatch');for(const [name,address] of Object.entries(manifest.contracts))if(address.toLowerCase()!==evidence.deployment.contracts[name]?.toLowerCase())throw new Error(`Evidence contract mismatch: ${name}`);
execFileSync(process.execPath,['scripts/pilot/verify-zk-evidence.mjs',sourcePath,rpc],{stdio:'inherit'});mkdirSync(dirname(resolve(publishedPath)),{recursive:true});writeFileSync(publishedPath,raw);
manifest.operationalEvidence={status:'completed',verificationVersion:1,format:evidence.format,evidencePath:relative(process.cwd(),resolve(publishedPath)),evidenceSHA256:createHash('sha256').update(raw).digest('hex'),snapshot:evidence.snapshot,flow:evidence.flow,rootRetirementTransactionHash:evidence.transactions.invalidateRoot.hash,verifiedAt:new Date().toISOString()};
manifest.features.zk='three real development Groth16 proofs verified on-chain and independently; unsafe ceremony';writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');console.log(`Recorded verified ZK_ONLY evidence in ${manifestPath}.`);
