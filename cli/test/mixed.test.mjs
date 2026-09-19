import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildMixedIssuer} from '../dist/mixedIssuer.js';
const wallet='0x1111111111111111111111111111111111111111';
const input={format:'ilal-mixed-issuer-v1',issuerHash:'11',schemaHash:'22',minimumKycLevel:2,allowedCountries:[840],credentials:[{wallet,kycLevel:3,countryCode:840,expiresAt:'2000000000'}]};
test('issuer tree metadata and private witness retain circuit policy meaning',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ilal-mixed-issuer-'));try{const result=buildMixedIssuer(input,dir,1n);const witness=JSON.parse(readFileSync(join(dir,wallet,'input.json')));assert.equal(result.eligible[0],wallet);assert.equal(witness.policyHash,result.metadata.zkPolicyHash.toString());assert.equal(witness.credentialPathElements.length,20);assert.equal(witness.jurisdictionPathElements.length,8);assert.equal(witness.walletBits.length,160);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('issuer rejects duplicates and never produces a witness for excluded attributes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ilal-mixed-issuer-'));try{assert.throws(()=>buildMixedIssuer({...input,credentials:[...input.credentials,...input.credentials]},dir,1n),/Duplicate/);assert.deepEqual(buildMixedIssuer({...input,minimumKycLevel:3,credentials:[{...input.credentials[0],kycLevel:2}]},dir,1n).eligible,[]);assert.throws(()=>buildMixedIssuer(input,dir,2000000001n),/expiry/);}finally{rmSync(dir,{recursive:true,force:true});}
});
