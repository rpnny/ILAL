import { createServer,type IncomingMessage,type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress,encodeFunctionData,erc20Abi,type Address,type Hex } from 'viem';
import { mixedJSON,readMixedOrderStatus,checkMixedDeployment,readMixedPolicy,quoteMixedOrders,parseMixedOrder,parseSignedMixedOrder,prepareMixedExecution,mixedDomain,mixedTypedData,MixedActivationFields,MixedLiquidityFields,MixedExecutionRouterAbi,MixedLiquidityRouterAbi,MixedGrantManagerAbi,MixedHookAbi,type MixedActivation,type MixedLiquidity,type SignedMixedOrder } from '@ilal/sdk';
import { mixedContext,activationFromPolicy,monitorMixed,parseLiquidity } from './mixed.js';
interface Options {manifest:string;rpc:string;port?:string;}
interface Challenge {user:Address;expires:number;kind:'order'|'grant'|'liquidity';direct?:boolean;payload:unknown;proof?:Hex;inputs?:bigint[];}
async function body(req:IncomingMessage):Promise<Record<string,unknown>>{let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>65536)throw new Error('Request too large');}return JSON.parse(text);}
export async function startMixedConsole(opts:Options) {
 const port=Number(opts.port??4174);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Port');
 const {client,deployment:d}=mixedContext(opts.manifest,opts.rpc);await checkMixedDeployment(client,d);
 const origin=`http://127.0.0.1:${port}`,host=`127.0.0.1:${port}`,token=randomBytes(32).toString('hex');
 const challenges=new Map<string,Challenge>();const assetDir=resolve(dirname(fileURLToPath(import.meta.url)),'../console-assets');
 const send=(res:ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(mixedJSON(data));};
 const server=createServer(async(req,res)=>{try{
  if(req.headers.host!==host||(req.headers.origin&&req.headers.origin!==origin)){send(res,403,{error:'Host/origin rejected'});return;}
  const url=new URL(req.url??'/',origin);
  if(!url.pathname.startsWith('/api/')){
   const name=url.pathname==='/'?'mixed.html':url.pathname.slice(1);if(!['mixed.html','mixed.css','mixed.js'].includes(name)){res.writeHead(404).end();return;}
   res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css':'text/javascript','Content-Security-Policy':"default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(readFileSync(resolve(assetDir,name)));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/session'){send(res,200,{token});return;}
  if(req.headers['x-ilal-session']!==token){send(res,403,{error:'Session token required'});return;}
  if(req.method==='GET'&&url.pathname==='/api/config'){send(res,200,{deployment:d});return;}
  if(req.method==='GET'&&url.pathname==='/api/state'){send(res,200,await monitorMixed(client,d,url.searchParams.get('user')?getAddress(url.searchParams.get('user')!):undefined));return;}
  if(req.method==='GET'&&url.pathname==='/api/receipt'){
   const hash=url.searchParams.get('hash') as Hex;if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw new Error('Hash');
   try{send(res,200,await client.getTransactionReceipt({hash}));}catch{send(res,200,{status:'pending'});}return;
  }
  if(req.method!=='POST'){send(res,404,{error:'Unknown route'});return;}const b=await body(req);
  if(url.pathname==='/api/status'){if(!Array.isArray(b.orders))throw new Error('Signed orders');send(res,200,await Promise.all(b.orders.map(x=>readMixedOrderStatus(client,d,parseSignedMixedOrder(x)))));return;}
  if(url.pathname==='/api/challenge'){
   const c=challenges.get(String(b.challengeId));if(!c||c.expires<Date.now()||c.kind!=='order')throw new Error('Draft expired or not local');
   send(res,200,{typedData:mixedTypedData(parseMixedOrder(c.payload),d.chainId,d.contracts.hook,!!c.direct)});return;
  }
  if(url.pathname==='/api/quote'){if(!Array.isArray(b.orders))throw new Error('Orders');send(res,200,await quoteMixedOrders(client,d,b.orders.map(parseMixedOrder),b.direct===true));return;}
  if(url.pathname==='/api/prepare'){
   const user=getAddress(String(b.user)),p=await readMixedPolicy(client,d),block=await client.getBlock(),deadline=block.timestamp+600n,nonce=`0x${randomBytes(32).toString('hex')}` as Hex;
   let challenge:Challenge,typedData:unknown;
   if(b.kind==='order'){
    const order=parseMixedOrder({...b.order as object,user,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,deadline,nonce});
    challenge={user,expires:Date.now()+600000,kind:'order',direct:b.direct===true,payload:order};typedData=mixedTypedData(order,d.chainId,d.contracts.hook,b.direct===true);
   }else if(b.kind==='grant'){
    const proof=String(b.proof??'0x') as Hex,inputs=(b.inputs as string[]??[]).map(BigInt);
    const activation=activationFromPolicy(user,d,p,Number(b.source),proof,inputs,block.timestamp);
    challenge={user,expires:Date.now()+600000,kind:'grant',payload:activation,proof,inputs};typedData={domain:mixedDomain(d.chainId,d.contracts.grantManager,true),types:{MixedActivation:MixedActivationFields},primaryType:'MixedActivation',message:activation};
   }else if(b.kind==='liquidity'){
    const a=parseLiquidity({...b.authorization as object,user,poolId:d.pool.poolId,executionPolicyHash:p.executionPolicyHash,policyRevision:p.revision,deadline,nonce});
    challenge={user,expires:Date.now()+600000,kind:'liquidity',payload:a};typedData={domain:mixedDomain(d.chainId,d.contracts.hook),types:{MixedLiquidity:MixedLiquidityFields},primaryType:'MixedLiquidity',message:a};
   }else throw new Error('Unsupported action');
   for(const [id,c] of challenges)if(c.expires<Date.now())challenges.delete(id);
   if(challenges.size>=256)throw new Error('Too many pending authorizations');
   const id=randomBytes(24).toString('hex');challenges.set(id,challenge);send(res,200,{challengeId:id,typedData});return;
  }
  if(url.pathname==='/api/signed'){
   const id=String(b.challengeId),c=challenges.get(id);if(!c||Date.now()>c.expires)throw new Error('Authorization challenge expired');
   const signature=String(b.signature) as Hex;if(!/^0x(?:[a-fA-F0-9]{2})+$/.test(signature))throw new Error('Signature');
   if(c.kind==='order'){
    const order=parseMixedOrder(c.payload);const file:SignedMixedOrder={format:'ilal-mixed-order-v1',kind:c.direct?'direct':'batch',domain:mixedDomain(d.chainId,d.contracts.hook),order,signature};
    const td=mixedTypedData(order,d.chainId,d.contracts.hook,!!c.direct);const valid=await client.verifyTypedData({...td,message:{...td.message},address:c.user,signature});if(!valid)throw new Error('Invalid wallet signature');
    challenges.delete(id);send(res,200,{order:file});return;
   }
   let to:Address,data:Hex;
   if(c.kind==='grant'){
    const args=[c.payload as MixedActivation,signature,c.proof!,c.inputs!] as const;
    await client.simulateContract({address:d.contracts.grantManager,abi:MixedGrantManagerAbi,functionName:'activate',args,account:c.user});to=d.contracts.grantManager;data=encodeFunctionData({abi:MixedGrantManagerAbi,functionName:'activate',args});
   }else{
    const args=[d.pool,c.payload as MixedLiquidity,signature] as const;
    await client.simulateContract({address:d.contracts.liquidityRouter,abi:MixedLiquidityRouterAbi,functionName:'modify',args,account:c.user});to=d.contracts.liquidityRouter;data=encodeFunctionData({abi:MixedLiquidityRouterAbi,functionName:'modify',args});
   }
   challenges.delete(id);send(res,200,{transaction:{from:c.user,to,data,value:'0x0'}});return;
  }
  if(url.pathname==='/api/execute-prepare'){
   if(!Array.isArray(b.orders))throw new Error('Signed orders');const files=b.orders.map(parseSignedMixedOrder),executor=getAddress(String(b.user));await prepareMixedExecution(client,d,files,executor);
   const data=files.length===1&&files[0].kind==='direct'?encodeFunctionData({abi:MixedExecutionRouterAbi,functionName:'executeDirectSwap',args:[d.pool,files[0].order,files[0].signature]}):encodeFunctionData({abi:MixedExecutionRouterAbi,functionName:'executeBatch',args:[d.pool,files.map(f=>f.order),files.map(f=>f.signature)]});
   send(res,200,{transaction:{from:executor,to:d.contracts.executionRouter,data,value:'0x0'}});return;
  }
  if(url.pathname==='/api/approve-prepare'){
   const user=getAddress(String(b.user)),asset=getAddress(String(b.token));if(![d.pool.currency0,d.pool.currency1].some(a=>a.toLowerCase()===asset.toLowerCase()))throw new Error('Token');
   const spender=b.liquidity===true?d.contracts.liquidityRouter:d.contracts.executionRouter,amount=BigInt(String(b.amount));
   await client.simulateContract({address:asset,abi:erc20Abi,functionName:'approve',args:[spender,amount],account:user});
   send(res,200,{transaction:{from:user,to:asset,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[spender,amount]}),value:'0x0'}});return;
  }
  if(url.pathname==='/api/cancel-prepare'){
   const user=getAddress(String(b.user)),namespace=Number(b.namespace),nonce=String(b.nonce) as Hex;if(!Number.isInteger(namespace)||namespace<0||namespace>5)throw new Error('Namespace');
   const to=namespace===2?d.contracts.grantManager:d.contracts.hook;
   await client.simulateContract({address:to,abi:MixedHookAbi,functionName:'cancelNonce',args:[namespace,nonce],account:user});
   send(res,200,{transaction:{from:user,to,data:encodeFunctionData({abi:MixedHookAbi,functionName:'cancelNonce',args:[namespace,nonce]}),value:'0x0'}});return;
  }
  send(res,404,{error:'Unknown route'});
 }catch(error){send(res,400,{error:error instanceof Error?error.message:String(error)});}});
 await new Promise<void>((ok,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',ok);});
 console.log(`ILAL console: ${origin}\nWallet signing only. Manifest: ${opts.manifest}`);
 return server;
}
