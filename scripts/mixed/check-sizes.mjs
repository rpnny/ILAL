import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const names=['MixedHook','MixedExecutionRouter','MixedLiquidityRouter','MixedGrantManager','MixedPolicyRegistry','MixedOracleGuard','ChainlinkStablecoinOracleGuard','Groth16VerifierAdapterV2','ILALPolicyVerifierV2'];
const sizes=Object.fromEntries(names.map(n=>{const a=JSON.parse(readFileSync(`contracts/out/${n}.sol/${n}.json`));const size=(a.deployedBytecode.object.length-2)/2;if(size>24576)throw new Error(`EIP-170 exceeded: ${n} ${size}`);return [n,size];}));
mkdirSync('artifacts/mixed',{recursive:true});writeFileSync('artifacts/mixed/contract-sizes.json',JSON.stringify({limit:24576,sizes},null,2)+'\n');console.log(sizes);
