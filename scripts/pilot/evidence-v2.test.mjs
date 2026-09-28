import test from 'node:test';
import assert from 'node:assert/strict';
import {flowFromEvents,pinned} from './evidence-v2.mjs';
const rows=[{input:70_000_000n,matchedInput:70_000_000n,ammInput:0n,ammOutput:0n},{input:100_000_000n,matchedInput:70_000_000n,ammInput:30_000_000n,ammOutput:29_984_991n}];
const swaps=[{amount0:0n,amount1:0n},{amount0:29_984_991n,amount1:-30_000_000n}];
test('independently compares residual allocation with PoolManager curve deltas',()=>{assert.equal(flowFromEvents(rows,swaps).actualAmmInput,'30000000');assert.throws(()=>flowFromEvents(rows,[swaps[0],{...swaps[1],amount1:-170_000_000n}]));assert.throws(()=>flowFromEvents(rows,[...swaps,swaps[1]]));assert.throws(()=>flowFromEvents(rows,[swaps[0],{...swaps[1],amount0:1n}]));});
test('every SDK state access is pinned, including nested quote deployment checks',async()=>{const calls=[];const client=Object.fromEntries(['getCode','readContract','simulateContract','getBlock'].map(k=>[k,async args=>calls.push([k,args])]));const fixed=pinned(client,12n);await fixed.getCode({address:'x'});await fixed.readContract({blockNumber:99n});await fixed.simulateContract({});await fixed.getBlock({blockTag:'latest'});assert(calls.every(([,args])=>args.blockNumber===12n));});
