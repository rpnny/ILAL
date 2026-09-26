/** Verify public-chain evidence, then bind its digest to the matching candidate manifest. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {validatePilotEvidence} from './model.mjs';
const [manifestPath,evidencePath,rpc]=process.argv.slice(2);if(!manifestPath||!evidencePath||!rpc)throw new Error('Usage: record-evidence.mjs manifest.json evidence.json explicit-rpc');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),raw=readFileSync(evidencePath),evidence=validatePilotEvidence(JSON.parse(raw));
if(manifest.format!=='ilal-mixed-deployment-v1'||manifest.chainId!==evidence.chainId||manifest.pool.poolId.toLowerCase()!==evidence.deployment.pool.poolId.toLowerCase())throw new Error('Evidence/manifest identity mismatch');
for(const [name,address] of Object.entries(manifest.contracts))if(address.toLowerCase()!==evidence.deployment.contracts[name]?.toLowerCase())throw new Error(`Evidence contract mismatch: ${name}`);
execFileSync(process.execPath,['scripts/pilot/verify-evidence.mjs',evidencePath,rpc],{stdio:'inherit'});
manifest.operationalEvidence={status:'completed',format:evidence.format,evidenceSHA256:createHash('sha256').update(raw).digest('hex'),snapshot:evidence.snapshot,flow:evidence.flow,verifiedAt:new Date().toISOString()};
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');console.log(`Recorded verified issuer-pilot evidence in ${manifestPath}.`);
