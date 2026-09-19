import { IncrementalMerkleTree } from '@zk-kit/incremental-merkle-tree';
import { poseidon2, poseidon6 } from 'poseidon-lite';
import { getAddress, keccak256, type Address } from 'viem';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
export interface MixedIssuerInput {
 format:'ilal-mixed-issuer-v1'; issuerHash:string; schemaHash:string; minimumKycLevel:number;
 allowedCountries:number[];
 credentials:{wallet:string;kycLevel:number;countryCode:number;expiresAt:string}[];
}
const fieldLimit=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function field(value:string):bigint { if(!/^\d+$/.test(value))throw new Error('Invalid field');const x=BigInt(value);if(x<=0n||x>=fieldLimit)throw new Error('Field out of range');return x; }
/** Issuer-controlled local input. Outputs private witnesses; never a claim of verified KYC. */
export function buildMixedIssuer(input:MixedIssuerInput,outputDir:string,now=BigInt(Math.floor(Date.now()/1000))) {
 if(input.format!=='ilal-mixed-issuer-v1'||!Number.isInteger(input.minimumKycLevel)||input.minimumKycLevel<0||input.minimumKycLevel>3)throw new Error('Issuer schema');
 const issuerHash=field(input.issuerHash),schemaHash=field(input.schemaHash);
 if(!Array.isArray(input.allowedCountries)||!input.allowedCountries.length||input.allowedCountries.length>256||new Set(input.allowedCountries).size!==input.allowedCountries.length)throw new Error('Country set');
 for(const c of input.allowedCountries)if(!Number.isInteger(c)||c<1||c>999)throw new Error('Country code');
 if(!Array.isArray(input.credentials)||!input.credentials.length||input.credentials.length>2**20)throw new Error('Credential count');
 const seen=new Set<string>();
 const rows=input.credentials.map(row=>{
  const wallet=getAddress(row.wallet);if(seen.has(wallet))throw new Error('Duplicate wallet');seen.add(wallet);
  if(!Number.isInteger(row.kycLevel)||row.kycLevel<0||row.kycLevel>3||!Number.isInteger(row.countryCode)||row.countryCode<1||row.countryCode>999)throw new Error('Credential attributes');
  const expiresAt=BigInt(row.expiresAt);if(expiresAt<=now||expiresAt>=(1n<<64n))throw new Error('Credential expiry');
  return {...row,wallet,expiresAt};
 });
 const tree=new IncrementalMerkleTree(poseidon2,20,0n,2),jurisdictions=new IncrementalMerkleTree(poseidon2,8,0n,2);
 for(const country of input.allowedCountries)jurisdictions.insert(poseidon2([BigInt(country),2n]));
 for(const row of rows)tree.insert(poseidon6([BigInt(row.wallet),BigInt(row.kycLevel),BigInt(row.countryCode),row.expiresAt,issuerHash,schemaHash]));
 const zkPolicyHash=poseidon6([2n,issuerHash,schemaHash,tree.root,BigInt(input.minimumKycLevel),jurisdictions.root]);
 const metadata={format:'ilal-mixed-policy-source-v1',issuerHash,schemaHash,acceptedRoot:tree.root,jurisdictionRoot:jurisdictions.root,zkPolicyHash,minKycLevel:input.minimumKycLevel,credentialCount:rows.length};
 const json=(x:unknown)=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
 const dir=resolve(outputDir);mkdirSync(dir,{recursive:true,mode:0o700});writeFileSync(join(dir,'policy-meta.json'),json(metadata),{mode:0o600});
 const eligible:Address[]=[];
 rows.forEach((row,i)=>{
  const countryIndex=input.allowedCountries.indexOf(row.countryCode);
  if(countryIndex<0||row.kycLevel<input.minimumKycLevel)return;
  const cp=tree.createProof(i),jp=jurisdictions.createProof(countryIndex),walletField=BigInt(row.wallet);
  const witness={walletField,walletBits:Array.from({length:160},(_,k)=>(walletField>>BigInt(k))&1n),kycLevel:row.kycLevel,countryCode:row.countryCode,
   credentialPathElements:cp.siblings.map(s=>s[0]),credentialPathIndices:cp.pathIndices,jurisdictionPathElements:jp.siblings.map(s=>s[0]),jurisdictionPathIndices:jp.pathIndices,
   walletHash:BigInt(keccak256(row.wallet))>>4n,issuerHash,schemaHash,expiresAt:row.expiresAt,credentialRoot:tree.root,minKycLevel:input.minimumKycLevel,jurisdictionRoot:jurisdictions.root,policyHash:zkPolicyHash,circuitVersion:2};
  const userDir=join(dir,row.wallet.toLowerCase());mkdirSync(userDir,{recursive:true,mode:0o700});writeFileSync(join(userDir,'input.json'),json(witness),{mode:0o600});eligible.push(row.wallet);
 });
 return {metadata,eligible,outputDir:dir};
}
