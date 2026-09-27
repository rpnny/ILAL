import test from 'node:test';
import assert from 'node:assert/strict';
import {isCanonicalReceipt,reconcileJournalReceipt} from './journal.mjs';

const zero=`0x${'00'.repeat(32)}`, canonical=`0x${'11'.repeat(32)}`, tx=`0x${'22'.repeat(32)}`;
const contract='0x1111111111111111111111111111111111111111';
const receipt={status:'success',blockNumber:12n,blockHash:canonical,contractAddress:contract,gasUsed:34n};

test('upgrades a preconfirmation journal row with its canonical receipt',()=>{
  assert.equal(isCanonicalReceipt({...receipt,blockHash:zero}),false);
  assert.deepEqual(reconcileJournalReceipt({transactionHash:tx,blockHash:zero,contractAddress:contract},receipt),{
    transactionHash:tx,blockNumber:'12',blockHash:canonical,contractAddress:contract,gasUsed:'34'
  });
});
test('rejects a changed canonical block or contract',()=>{
  assert.throws(()=>reconcileJournalReceipt({transactionHash:tx,blockHash:`0x${'33'.repeat(32)}`,contractAddress:contract},receipt),/Reorged/);
  assert.throws(()=>reconcileJournalReceipt({transactionHash:tx,blockHash:zero,contractAddress:'0x2222222222222222222222222222222222222222'},receipt),/contract mismatch/);
});
