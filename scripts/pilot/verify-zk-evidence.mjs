import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {verifyZkEvidence} from './zk-evidence.mjs';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));const {createPublicClient,http}=require('viem');
const [path,rpc]=process.argv.slice(2);if(!rpc)throw new Error('Usage: verify-zk-evidence.mjs evidence.json rpc');const evidence=JSON.parse(readFileSync(path,'utf8')),client=createPublicClient({transport:http(rpc),cacheTime:0});console.log(JSON.stringify(await verifyZkEvidence(client,evidence),null,2));process.exit(0);
