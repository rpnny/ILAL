/** Base Sepolia phased lifecycle. Use the same journal to resume after the real timelock. */
import {readFileSync,statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {lifecycleV2} from './lifecycle-v2.mjs';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,createWalletClient,defineChain,http}=require('viem');
const {privateKeyToAccount}=require('viem/accounts');
const [manifestPath,rpc,walletPath,journalPath,outputPath]=process.argv.slice(2);
if(!outputPath)throw new Error('Usage: rehearse-v2.mjs manifest.json rpc external-wallets.json journal.json evidence.json');
if((statSync(walletPath).mode&0o077)!==0)throw new Error('Wallet file must be private (0600)');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
if(manifest.chainId!==84532||manifest.operationalEvidence?.status!=='not completed')throw new Error('An incomplete Base Sepolia candidate is required');
const chain=defineChain({id:84532,name:'Base Sepolia',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}},testnet:true});
const client=createPublicClient({chain,transport:http(rpc),cacheTime:0,pollingInterval:1000});if(await client.getChainId()!==84532)throw new Error('Wrong chain');
const wallets=Object.fromEntries(JSON.parse(readFileSync(walletPath,'utf8')).map(([role,address,key])=>{const account=privateKeyToAccount(`0x${key.replace(/^0x/,'')}`);if(account.address.toLowerCase()!==address.toLowerCase())throw new Error(`Wallet mismatch: ${role}`);return [role,createWalletClient({account,chain,transport:http(rpc)})];}));
console.log(JSON.stringify(await lifecycleV2({client,wallets,manifest,journalPath,outputPath}),null,2));
