import { readFileSync,writeFileSync } from 'node:fs';
const names=['MixedHook','MixedExecutionRouter','MixedLiquidityRouter','MixedGrantManager','MixedPolicyRegistry','MixedOracleGuard'];
const text='// Generated from Foundry artifacts by scripts/mixed/sync-abis.mjs.\n'+names.map(n=>`export const ${n}Abi = ${JSON.stringify(JSON.parse(readFileSync(`contracts/out/${n}.sol/${n}.json`,'utf8')).abi)} as const;`).join('\n')+'\n';
const path='sdk/src/mixed/abi.ts';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==text)throw new Error('Mixed ABI drift');}else writeFileSync(path,text);
