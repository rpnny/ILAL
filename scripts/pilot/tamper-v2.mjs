/** Run while the isolated Anvil process is alive. Each mutation must fail independently. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {verifyV2} from './evidence-v2.mjs';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));const {createPublicClient,http}=require('viem');
const [path,rpc]=process.argv.slice(2),original=JSON.parse(readFileSync(path,'utf8')),client=createPublicClient({transport:http(rpc)});
const mutations={
 'checkpoint hash':e=>e.snapshot.blockHash=`0x${'11'.repeat(32)}`,
 'wrong chain':e=>e.chainId=84532,
 'missing negative case':e=>delete e.cases.revocation,
 'signature':e=>e.cases.revision.signed[0].signature=`0x${'11'.repeat(65)}`,
 'quote output':e=>e.cases.revision.quote.allocations[0].output='1',
 'transaction target':e=>e.transactions.activatePolicyChange.to=e.roles.executor,
 'failed nonce':e=>e.cases.revision.stateAfter.nonces[0]=true,
 'flow claim':e=>e.flow.actualAmmInput='170000000',
 'collect delta':e=>e.lp.collect.authorization.liquidityDelta='-1',
 'collect balance':e=>{const k=Object.keys(e.lp.collect.stateAfter.balances)[0];e.lp.collect.stateAfter.balances[k]='1';},
};
for(const [name,mutate] of Object.entries(mutations)){const e=structuredClone(original);mutate(e);await assert.rejects(()=>verifyV2(client,e),undefined,name);console.log(`Rejected tampering: ${name}`);}
await assert.rejects(()=>verifyV2({...client,getBlock:async()=>{throw new Error('Historical RPC unavailable');}},original),/Historical RPC unavailable/);
