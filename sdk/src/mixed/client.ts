import { decodeErrorResult, encodeAbiParameters, getAddress, keccak256, erc20Abi, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from 'viem';
import { MixedHookAbi, MixedExecutionRouterAbi, MixedLiquidityRouterAbi, MixedGrantManagerAbi, MixedPolicyRegistryAbi, MixedOracleGuardAbi } from './abi.js';
import { matchingBudget, allocateMatch, MAX_AMOUNT } from './model.js';
import { hashMixedOrder, mixedDomain, mixedTypedData, type MixedOrder, MixedActivationFields, type MixedActivation, MixedLiquidityFields, type MixedLiquidity } from './types.js';

export interface MixedDeployment {
 format:'ilal-mixed-deployment-v1'; chainId:number;
 contracts:{poolManager:Address;hook:Address;executionRouter:Address;liquidityRouter:Address;oracle:Address;grantManager:Address;policyRegistry:Address};
 pool:{currency0:Address;currency1:Address;fee:500;tickSpacing:10;hooks:Address;poolId:Hex};
 classification:'local-development'|'testnet'|'production';
 ceremony:'unsafe-development'|'reviewed-production';
 codeHashes?:Partial<Record<keyof MixedDeployment['contracts'],Hex>>;
}
export interface SignedMixedOrder {
 format:'ilal-mixed-order-v1';kind:'batch'|'direct';domain:ReturnType<typeof mixedDomain>;order:MixedOrder;signature:Hex;
}
export const mixedJSON = (value:unknown) => JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v,2);
export function parseMixedOrder(value:unknown):MixedOrder {
 if(!value||typeof value!=='object')throw new Error('Mixed order object required');
 const x=value as Record<string,unknown>;
 const hex=(name:string)=>{const h=x[name];if(typeof h!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(h))throw new Error(`Invalid ${name}`);return h as Hex;};
 const uint=(name:string,bits:number)=>{const v=x[name];if(!['string','bigint'].includes(typeof v)||!/^\d+$/.test(String(v)))throw new Error(`Invalid ${name}`);const n=BigInt(String(v));if(n>=(1n<<BigInt(bits)))throw new Error(`Overflow ${name}`);return n;};
 if(typeof x.zeroForOne!=='boolean')throw new Error('Direction must be boolean');
 const order:MixedOrder={user:getAddress(String(x.user)),poolId:hex('poolId'),executionPolicyHash:hex('executionPolicyHash'),policyRevision:uint('policyRevision',64),zeroForOne:x.zeroForOne,amountIn:uint('amountIn',128),minAmountOut:uint('minAmountOut',128),maxAmmInput:uint('maxAmmInput',128),minSqrtPriceX96:uint('minSqrtPriceX96',160),maxSqrtPriceX96:uint('maxSqrtPriceX96',160),deadline:uint('deadline',64),nonce:hex('nonce')};
 if(order.amountIn===0n||order.amountIn>MAX_AMOUNT||order.minSqrtPriceX96===0n||order.minSqrtPriceX96>order.maxSqrtPriceX96)throw new Error('Order bounds');
 return order;
}
export function parseSignedMixedOrder(value:unknown):SignedMixedOrder {
 const x=value as SignedMixedOrder;
 if(!x||x.format!=='ilal-mixed-order-v1'||!['batch','direct'].includes(x.kind)||!/^0x(?:[a-fA-F0-9]{2})+$/.test(x.signature)||x.domain?.name!=='ILAL Mixed Hook'||x.domain.version!=='1'||!Number.isSafeInteger(x.domain.chainId)||x.domain.chainId<=0)throw new Error('Unsupported signed order/domain');
 return {...x,domain:{...x.domain,verifyingContract:getAddress(x.domain.verifyingContract)},order:parseMixedOrder(x.order)};
}
export function validateMixedDeployment(d:MixedDeployment) {
 if(d.format!=='ilal-mixed-deployment-v1'||!Number.isSafeInteger(d.chainId)||d.chainId<=0||d.pool.fee!==500||d.pool.tickSpacing!==10)throw new Error('Unsupported Mixed deployment');
 for(const a of Object.values(d.contracts))getAddress(a);
 if(BigInt(d.pool.currency0)>=BigInt(d.pool.currency1)||BigInt(d.pool.currency0)===0n||d.pool.hooks.toLowerCase()!==d.contracts.hook.toLowerCase())throw new Error('Pool binding');
 const id=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[d.pool.currency0,d.pool.currency1,500,10,d.pool.hooks]));
 if(id.toLowerCase()!==d.pool.poolId.toLowerCase())throw new Error('Pool ID mismatch');
 if(d.classification==='production'&&(d.ceremony!=='reviewed-production'||Object.keys(d.codeHashes??{}).length!==7))throw new Error('Production evidence missing');
}
export async function checkMixedDeployment(client:PublicClient,d:MixedDeployment) {
 validateMixedDeployment(d);if(await client.getChainId()!==d.chainId)throw new Error('Chain mismatch');
 for(const [name,address] of Object.entries(d.contracts)){
  const code=await client.getCode({address});if(!code||code==='0x')throw new Error(`Missing ${name} code`);
  const expected=d.codeHashes?.[name as keyof MixedDeployment['contracts']];if(expected&&keccak256(code)!==expected)throw new Error(`Code hash mismatch: ${name}`);
 }
 const [execution,liquidity,manager,oracle,eligibility,poolId,boundExecution,boundLiquidity,registry,token0,token1,decimals0,decimals1]=await Promise.all([
  client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'executionRouter'}),
  client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'liquidityRouter'}),
  client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'poolManager'}),
  client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'oracle'}),
  client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'eligibility'}),
  client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'supportedPoolId'}),
  client.readContract({address:d.contracts.executionRouter,abi:MixedExecutionRouterAbi,functionName:'canonicalHook'}),
  client.readContract({address:d.contracts.liquidityRouter,abi:MixedLiquidityRouterAbi,functionName:'canonicalHook'}),
  client.readContract({address:d.contracts.grantManager,abi:MixedGrantManagerAbi,functionName:'registry'}),
  client.readContract({address:d.contracts.oracle,abi:MixedOracleGuardAbi,functionName:'token0'}),
  client.readContract({address:d.contracts.oracle,abi:MixedOracleGuardAbi,functionName:'token1'}),
  client.readContract({address:d.pool.currency0,abi:erc20Abi,functionName:'decimals'}),client.readContract({address:d.pool.currency1,abi:erc20Abi,functionName:'decimals'})]);
 const actual=[execution,liquidity,manager,oracle,eligibility,poolId,boundExecution,boundLiquidity,registry,token0,token1];
 const expected=[d.contracts.executionRouter,d.contracts.liquidityRouter,d.contracts.poolManager,d.contracts.oracle,d.contracts.grantManager,d.pool.poolId,d.contracts.hook,d.contracts.hook,d.contracts.policyRegistry,d.pool.currency0,d.pool.currency1];
 if(actual.some((v,i)=>v.toLowerCase()!==expected[i].toLowerCase())||decimals0!==decimals1)throw new Error('On-chain deployment binding mismatch');
 return {decimals:decimals0};
}
export async function readMixedPolicy(client:PublicClient,d:MixedDeployment,blockNumber?:bigint) {
 return client.readContract({address:d.contracts.policyRegistry,abi:MixedPolicyRegistryAbi,functionName:'getPolicy',args:[d.pool.poolId],blockNumber});
}
export async function spendRequirements(client:PublicClient,d:MixedDeployment,orders:MixedOrder[],blockNumber?:bigint) {
 const grouped=new Map<string,{user:Address;token:Address;required:bigint}>();
 for(const o of orders){const token=o.zeroForOne?d.pool.currency0:d.pool.currency1,k=`${o.user.toLowerCase()}:${token.toLowerCase()}`;const row=grouped.get(k)??{user:o.user,token,required:0n};row.required+=o.amountIn;grouped.set(k,row);}
 return Promise.all([...grouped.values()].map(async row=>({...row,spender:d.contracts.executionRouter,allowance:await client.readContract({address:row.token,abi:erc20Abi,functionName:'allowance',args:[row.user,d.contracts.executionRouter],blockNumber}),balance:await client.readContract({address:row.token,abi:erc20Abi,functionName:'balanceOf',args:[row.user],blockNumber})})));
}
export function quoteResult(error:unknown):readonly [Hex,readonly bigint[]] {
 const seen=new Set<unknown>();let e:unknown=error;
 while(e&&typeof e==='object'&&!seen.has(e)){
  seen.add(e);const item=e as {data?:unknown;cause?:unknown};const data=item.data;
  if(data&&typeof data==='object'&&(data as {errorName?:string}).errorName==='QuoteResult')return (data as {args:readonly [Hex,readonly bigint[]]}).args;
  if(typeof data==='string'&&data.startsWith('0x')){try{const parsed=decodeErrorResult({abi:MixedExecutionRouterAbi,data:data as Hex});if(parsed.errorName==='QuoteResult')return parsed.args;}catch{}}
  e=item.cause;
 }
 throw error;
}
/** Executes full settlement in eth_call; quoteBatch ALWAYS reverts, restoring every mutation. */
export async function quoteMixedOrders(client:PublicClient,d:MixedDeployment,orders:MixedOrder[],direct=false) {
 await checkMixedDeployment(client,d);
 if((direct&&orders.length!==1)||(!direct&&(orders.length<2||orders.length>16)))throw new Error('Order count');
 for(const o of orders)if(o.poolId.toLowerCase()!==d.pool.poolId.toLowerCase())throw new Error('Order pool mismatch');
 const sorted=[...orders].sort((a,b)=>hashMixedOrder(a,direct)<hashMixedOrder(b,direct)?-1:1);
 const block=await client.getBlock();const blockNumber=block.number;
 const slot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[d.pool.poolId,6n]));
 const raw=await client.readContract({address:d.contracts.poolManager,abi:parseAbi(['function extsload(bytes32) view returns (bytes32)']),functionName:'extsload',args:[slot],blockNumber});
 const referencePrice=BigInt(raw)&((1n<<160n)-1n);
 const spending=await spendRequirements(client,d,orders,blockNumber);
 if(spending.some(x=>x.allowance<x.required||x.balance<x.required))throw new Error(`Spending permission/balance required: ${mixedJSON(spending)}`);
 let result:readonly [Hex,readonly bigint[]];
 try {await client.simulateContract({address:d.contracts.executionRouter,abi:MixedExecutionRouterAbi,functionName:'quoteBatch',args:[d.pool,orders,direct],blockNumber});throw new Error('Quote unexpectedly succeeded');}catch(error){result=quoteResult(error);}
 const budget=direct?null:matchingBudget(sorted.filter(o=>o.zeroForOne).reduce((s,o)=>s+o.amountIn,0n),sorted.filter(o=>!o.zeroForOne).reduce((s,o)=>s+o.amountIn,0n),referencePrice);
 let c0=0n,c1=0n;
 const allocations=sorted.map((o,i)=>{const a=budget?allocateMatch(budget,o.zeroForOne,o.zeroForOne?c0:c1,o.amountIn):{matchedInput:0n,matchedOutput:0n,residual:o.amountIn};if(o.zeroForOne)c0+=o.amountIn;else c1+=o.amountIn;
 return {order:o,orderHash:hashMixedOrder(o,direct),...a,output:result[1][i],ammOutput:result[1][i]-a.matchedOutput};});
 return {format:'ilal-mixed-quote-v1',snapshot:{blockNumber,blockHash:block.hash,timestamp:block.timestamp},commitment:result[0],referencePrice,internalFee:0n,protocolFee:0n,budget,allocations,spending};
}
export async function signMixedOrder(wallet:WalletClient,d:MixedDeployment,order:MixedOrder,direct=false):Promise<SignedMixedOrder>{
 const account=wallet.account;if(!account||account.address.toLowerCase()!==order.user.toLowerCase())throw new Error('Signer/user mismatch');
 if(await wallet.getChainId()!==d.chainId)throw new Error('Wallet chain mismatch');
 return {format:'ilal-mixed-order-v1',kind:direct?'direct':'batch',domain:mixedDomain(d.chainId,d.contracts.hook),order,signature:await wallet.signTypedData({...mixedTypedData(order,d.chainId,d.contracts.hook,direct),account})};
}
export async function prepareMixedExecution(client:PublicClient,d:MixedDeployment,files:SignedMixedOrder[],executor:Address) {
 await checkMixedDeployment(client,d);const direct=files.length===1&&files[0].kind==='direct';
 for(const f of files){if(f.kind!==(direct?'direct':'batch')||f.domain.chainId!==d.chainId||f.domain.verifyingContract.toLowerCase()!==d.contracts.hook.toLowerCase()||f.domain.name!=='ILAL Mixed Hook'||f.domain.version!=='1')throw new Error('Signed domain/kind mismatch');}
 return direct?client.simulateContract({address:d.contracts.executionRouter,abi:MixedExecutionRouterAbi,functionName:'executeDirectSwap',args:[d.pool,files[0].order,files[0].signature],account:executor}):client.simulateContract({address:d.contracts.executionRouter,abi:MixedExecutionRouterAbi,functionName:'executeBatch',args:[d.pool,files.map(f=>f.order),files.map(f=>f.signature)],account:executor});
}
export async function executeMixedOrders(client:PublicClient,wallet:WalletClient,d:MixedDeployment,files:SignedMixedOrder[]) {
 if(!wallet.account)throw new Error('Wallet required');if(await wallet.getChainId()!==d.chainId)throw new Error('Wallet chain mismatch');
 await prepareMixedExecution(client,d,files,wallet.account.address);
 const hash=files.length===1&&files[0].kind==='direct'
 ? await wallet.writeContract({address:d.contracts.executionRouter,abi:MixedExecutionRouterAbi,functionName:"executeDirectSwap",args:[d.pool,files[0].order,files[0].signature],account:wallet.account,chain:wallet.chain})
 : await wallet.writeContract({address:d.contracts.executionRouter,abi:MixedExecutionRouterAbi,functionName:"executeBatch",args:[d.pool,files.map(f=>f.order),files.map(f=>f.signature)],account:wallet.account,chain:wallet.chain});
 const receipt=await client.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw new Error(`Execution reverted: ${hash}`);return receipt;
}
export async function activateMixedGrant(client:PublicClient,wallet:WalletClient,d:MixedDeployment,a:MixedActivation,proof:Hex,inputs:bigint[]) {
 await checkMixedDeployment(client,d);if(!wallet.account||wallet.account.address.toLowerCase()!==a.user.toLowerCase()||await wallet.getChainId()!==d.chainId)throw new Error('Grant signer mismatch');
 const signature=await wallet.signTypedData({account:wallet.account,domain:mixedDomain(d.chainId,d.contracts.grantManager,true),types:{MixedActivation:MixedActivationFields},primaryType:'MixedActivation',message:a});
 const {request}=await client.simulateContract({address:d.contracts.grantManager,abi:MixedGrantManagerAbi,functionName:'activate',args:[a,signature,proof,inputs],account:wallet.account});
 return wallet.writeContract({...request,account:wallet.account,chain:wallet.chain});
}
export async function modifyMixedLiquidity(client:PublicClient,wallet:WalletClient,d:MixedDeployment,a:MixedLiquidity) {
 await checkMixedDeployment(client,d);if(!wallet.account||wallet.account.address.toLowerCase()!==a.user.toLowerCase()||await wallet.getChainId()!==d.chainId)throw new Error('LP owner mismatch');
 const signature=await wallet.signTypedData({account:wallet.account,domain:mixedDomain(d.chainId,d.contracts.hook),types:{MixedLiquidity:MixedLiquidityFields},primaryType:'MixedLiquidity',message:a});
 const {request}=await client.simulateContract({address:d.contracts.liquidityRouter,abi:MixedLiquidityRouterAbi,functionName:'modify',args:[d.pool,a,signature],account:wallet.account});
 return wallet.writeContract({...request,account:wallet.account,chain:wallet.chain});
}
export async function cancelMixedNonce(client:PublicClient,wallet:WalletClient,d:MixedDeployment,namespace:number,nonce:Hex) {
 if(!wallet.account||namespace<0||namespace>5||!Number.isInteger(namespace)||await wallet.getChainId()!==d.chainId)throw new Error('Cancellation parameters');
 const address=namespace===2?d.contracts.grantManager:d.contracts.hook;
 const {request}=await client.simulateContract({address,abi:MixedHookAbi,functionName:'cancelNonce',args:[namespace,nonce],account:wallet.account});
 return wallet.writeContract({...request,account:wallet.account,chain:wallet.chain});
}

/** A consumed nonce is final. Without indexed history, execution vs cancellation is deliberately not guessed. */
export async function readMixedOrderStatus(client:PublicClient,d:MixedDeployment,file:SignedMixedOrder) {
 await checkMixedDeployment(client,d);
 const block=await client.getBlock(),o=file.order;
 if(file.domain.chainId!==d.chainId||file.domain.verifyingContract.toLowerCase()!==d.contracts.hook.toLowerCase()||o.poolId.toLowerCase()!==d.pool.poolId.toLowerCase())throw new Error('Order deployment mismatch');
 const used=await client.readContract({address:d.contracts.hook,abi:MixedHookAbi,functionName:'nonceUsed',args:[o.user,file.kind==='direct'?1:0,o.nonce],blockNumber:block.number});
 const eligible=await client.readContract({address:d.contracts.grantManager,abi:MixedGrantManagerAbi,functionName:'isEligible',args:[o.poolId,o.user,o.executionPolicyHash,o.policyRevision],blockNumber:block.number});
 return {user:o.user,nonce:o.nonce,kind:file.kind,blockNumber:block.number,state:used?'consumed-or-cancelled':block.timestamp>o.deadline?'expired':!eligible?'ineligible':'pending-authorization',note:'Pending does not guarantee execution. Verify signatures, allowance, balance, price and the full batch with simulation.'};
}
export async function readMixedMarket(client:PublicClient,d:MixedDeployment,blockNumber?:bigint) {
 const slot=keccak256(encodeAbiParameters([{type:'bytes32'},{type:'uint256'}],[d.pool.poolId,6n]));
 const raw=await client.readContract({address:d.contracts.poolManager,abi:parseAbi(['function extsload(bytes32) view returns(bytes32)']),functionName:'extsload',args:[slot],blockNumber});
 const referencePrice=BigInt(raw)&((1n<<160n)-1n);
 try{await client.readContract({address:d.contracts.oracle,abi:MixedOracleGuardAbi,functionName:'validate',args:[referencePrice],blockNumber});return {referencePrice,healthy:true,error:null};}
 catch(e){return {referencePrice,healthy:false,error:e instanceof Error?e.message:String(e)};}
}
