/** Build issuer witnesses and real development Groth16 proofs. Never reads or emits wallet private keys. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {buildMixedIssuer} from '../../cli/dist/mixedIssuer.js';
import {validatePilotConfig} from './model.mjs';
const sdkRequire=createRequire(new URL('../../sdk/package.json',import.meta.url));
const circuitsRequire=createRequire(new URL('../../circuits/package.json',import.meta.url));
const {encodeAbiParameters,getAddress,keccak256,toBytes}=sdkRequire('viem');
const {groth16}=circuitsRequire('snarkjs');
const FIELD=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const sha256=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const field=label=>String((BigInt(keccak256(toBytes(label)))%(FIELD-1n))+1n);

export async function prepareZkPilot({walletPath,outputDir,configPath,candidateVersion='1.0.0-issuer-pilot-testnet.3',expiresAt='2000000000'}){
 if((statSync(walletPath).mode&0o077)!==0)throw new Error('Wallet file must be private (0600)');
 const publicRows=JSON.parse(readFileSync(walletPath,'utf8')).map(([role,address])=>[role,getAddress(address)]);
 const roles=Object.fromEntries(publicRows),required=['deployer','issuer','settlementAssetOperator','liquidityProvider','institutionA','institutionB','executor'];
 if(required.some(role=>!roles[role])||Object.keys(roles).length!==required.length)throw new Error('Seven pilot roles required');
 const root=resolve(new URL('../..',import.meta.url).pathname),out=resolve(outputDir),witnessDir=join(out,'witnesses');mkdirSync(out,{recursive:true,mode:0o700});
 const issuerInput={format:'ilal-mixed-issuer-v1',issuerHash:field('ILAL issuer pilot ZK issuer v1'),schemaHash:field('ILAL issuer pilot ZK eligibility schema v1'),minimumKycLevel:2,allowedCountries:[840,826,756],credentials:['liquidityProvider','institutionA','institutionB'].map(role=>({wallet:roles[role],kycLevel:3,countryCode:840,expiresAt}))};
 const built=buildMixedIssuer(issuerInput,witnessDir,0n),wasm=join(root,'circuits/build-v2/ilal_policy_js/ilal_policy.wasm'),zkey=join(root,'circuits/build-v2/ilal_policy_v2.zkey'),vkeyPath=join(root,'circuits/build-v2/ilal_policy_v2_vkey.json'),vkey=JSON.parse(readFileSync(vkeyPath,'utf8')),proofs=[];
 for(const role of ['liquidityProvider','institutionA','institutionB']){
  const wallet=roles[role],input=JSON.parse(readFileSync(join(witnessDir,wallet.toLowerCase(),'input.json'),'utf8')),{proof,publicSignals}=await groth16.fullProve(input,wasm,zkey);
  if(!await groth16.verify(vkey,publicSignals,proof))throw new Error(`Invalid generated proof: ${role}`);
  const encoded=encodeAbiParameters([{type:'uint256[2]'},{type:'uint256[2][2]'},{type:'uint256[2]'}],[proof.pi_a.slice(0,2).map(BigInt),[proof.pi_b[0].slice(0,2).reverse().map(BigInt),proof.pi_b[1].slice(0,2).reverse().map(BigInt)],proof.pi_c.slice(0,2).map(BigInt)]);
  proofs.push({role,wallet,proof:encoded,inputs:publicSignals.map(String)});
 }
 const bundle={format:'ilal-zk-pilot-proof-bundle-v1',classification:'unsafe development Groth16 ceremony; Base Sepolia testnet only',circuitVersion:2,artifacts:{zkeySHA256:sha256(zkey),vkeySHA256:sha256(vkeyPath)},metadata:JSON.parse(JSON.stringify(built.metadata,(_,v)=>typeof v==='bigint'?String(v):v)),proofs};
 const policy={mode:'ZK_ONLY',grantTtlSeconds:3600,issuerHash:String(built.metadata.issuerHash),schemaHash:String(built.metadata.schemaHash),acceptedRoot:String(built.metadata.acceptedRoot),jurisdictionRoot:String(built.metadata.jurisdictionRoot),zkPolicyHash:String(built.metadata.zkPolicyHash),minKycLevel:built.metadata.minKycLevel};
 const config=validatePilotConfig({format:'ilal-issuer-pilot-config-v1',candidateVersion,chainId:84532,roles,assets:{issuerStablecoin:{name:'Issuer ZK Pilot Stablecoin',symbol:'zkUSD',decimals:6,role:'issuer-stablecoin'},settlementCash:{name:'USDC-like Sandbox Settlement Cash',symbol:'sUSDC',decimals:6,role:'sandbox-settlement-cash'}},scenario:{issuerAssetInput:'100000000',settlementCashInput:'70000000',tickLower:-1000,tickUpper:1000,liquidityDelta:'100000000000000'},policy});
 mkdirSync(dirname(resolve(configPath)),{recursive:true});writeFileSync(join(out,'proof-bundle.json'),JSON.stringify(bundle,null,2)+'\n',{mode:0o600});writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
 return {configPath,proofBundlePath:join(out,'proof-bundle.json'),policy};
}

if(process.argv[1]===new URL(import.meta.url).pathname){const [walletPath,outputDir='artifacts/pilot/zk',configPath='artifacts/pilot/zk-config.json',candidateVersion]=process.argv.slice(2);if(!walletPath)throw new Error('Usage: prepare-zk-pilot.mjs external-wallets.json [output-dir] [config.json] [candidate-version]');console.log(JSON.stringify(await prepareZkPilot({walletPath,outputDir,configPath,candidateVersion}),null,2));process.exit(0);}
