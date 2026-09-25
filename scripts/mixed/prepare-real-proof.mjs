import { createRequire } from 'node:module';
import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMixedIssuer } from '../../cli/dist/mixedIssuer.js';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const sdkRequire=createRequire(join(root,'sdk/package.json')),circuitsRequire=createRequire(join(root,'circuits/package.json'));
const {privateKeyToAccount}=sdkRequire('viem/accounts'),{encodeAbiParameters}=sdkRequire('viem');
const {groth16}=circuitsRequire('snarkjs');
const wallets=[0xA11CEn,0xB0Bn].map(k=>privateKeyToAccount(`0x${k.toString(16).padStart(64,'0')}`).address);
const out=join(root,'artifacts/mixed/proofs');mkdirSync(out,{recursive:true,mode:0o700});
const result=buildMixedIssuer({format:'ilal-mixed-issuer-v1',issuerHash:'11',schemaHash:'22',minimumKycLevel:2,allowedCountries:[840,826,756],credentials:wallets.map(wallet=>({wallet,kycLevel:3,countryCode:840,expiresAt:'2000000000'}))},out,0n);
const proofs=[];for(const wallet of wallets){
 const input=JSON.parse(readFileSync(join(out,wallet.toLowerCase(),'input.json'),'utf8'));
 const {proof,publicSignals}=await groth16.fullProve(input,join(root,'circuits/build-v2/ilal_policy_js/ilal_policy.wasm'),join(root,'circuits/build-v2/ilal_policy_v2.zkey'));
 const vkey=JSON.parse(readFileSync(join(root,'circuits/build-v2/ilal_policy_v2_vkey.json'),'utf8'));
 if(!await groth16.verify(vkey,publicSignals,proof))throw new Error('Invalid generated proof');
 const encoded=encodeAbiParameters([{type:'uint256[2]'},{type:'uint256[2][2]'},{type:'uint256[2]'}],[proof.pi_a.slice(0,2).map(BigInt),[proof.pi_b[0].slice(0,2).reverse().map(BigInt),proof.pi_b[1].slice(0,2).reverse().map(BigInt)],proof.pi_c.slice(0,2).map(BigInt)]);
 proofs.push({wallet,proof:encoded,inputs:publicSignals.map(BigInt)});
}
writeFileSync(join(out,'fixture.json'),JSON.stringify({classification:'unsafe development proof, local tests only',metadata:result.metadata,proofs},(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n',{mode:0o600});
console.log('Verified two real development Groth16 proofs sharing one policy root.');
process.exit(0);
