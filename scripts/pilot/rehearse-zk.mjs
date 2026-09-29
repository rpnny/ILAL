import {createRequire} from 'node:module';
import {readFileSync,statSync} from 'node:fs';
import {lifecycleZk} from './lifecycle-zk.mjs';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {createPublicClient,createWalletClient,defineChain,http}=require('viem'),{privateKeyToAccount}=require('viem/accounts');
const [manifestPath,rpc,walletPath,proofPath,journalPath,outputPath]=process.argv.slice(2);if(!outputPath)throw new Error('Usage: rehearse-zk.mjs manifest.json rpc wallets.json proof-bundle.json journal.json evidence.json');if((statSync(walletPath).mode&0o077)!==0)throw new Error('Wallet file must be private (0600)');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')),proofBundle=JSON.parse(readFileSync(proofPath,'utf8'));if(manifest.chainId!==84532||manifest.pilot?.policy?.mode!=='ZK_ONLY'||manifest.operationalEvidence?.status!=='not completed')throw new Error('Incomplete Base Sepolia ZK_ONLY candidate required');
const chain=defineChain({id:84532,name:'Base Sepolia',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}},testnet:true}),client=createPublicClient({chain,transport:http(rpc),cacheTime:0,pollingInterval:1000});
const wallets=Object.fromEntries(JSON.parse(readFileSync(walletPath,'utf8')).map(([role,address,key])=>{const account=privateKeyToAccount(`0x${key.replace(/^0x/,'')}`);if(account.address.toLowerCase()!==address.toLowerCase())throw new Error(`Wallet mismatch: ${role}`);return [role,createWalletClient({account,chain,transport:http(rpc)})];}));console.log(JSON.stringify(await lifecycleZk({client,wallets,manifest,proofBundle,journalPath,outputPath}),null,2));
