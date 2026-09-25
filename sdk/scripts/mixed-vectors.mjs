import {matchingBudget,allocateMatch,MIN_SQRT,MAX_SQRT} from '../dist/mixed/model.js';
import {hashMixedOrder,orderSetCommitment} from '../dist/mixed/types.js';
import {encodeAbiParameters} from 'viem';
// One FFI call compares the Solidity implementation with the independently executed bigint model.
const rows=[];
let seed=73n;
for(let i=0;i<128;i++){
 seed=(seed*1103515245n+12345n)%2147483648n;
 const x=1000000n+seed, y=1000000n+(seed*17n)%2147483648n, other=1000000n+(seed*31n)%2147483648n;
 const s=[MIN_SQRT,1n<<96n,MAX_SQRT][i%3];
 const b=matchingBudget(x+y,other,s),a=allocateMatch(b,true,0n,x),c=allocateMatch(b,true,x,y);
 rows.push([x,y,other,s,b.matched0,b.matched1,a.matchedInput,a.matchedOutput,c.matchedInput,c.matchedOutput]);
}
const hook='0x1111111111111111111111111111111111111111',z=`0x${'00'.repeat(32)}`;
const a={user:hook,poolId:z,executionPolicyHash:z,policyRevision:1n,zeroForOne:true,amountIn:100n,minAmountOut:1n,maxAmmInput:100n,minSqrtPriceX96:MIN_SQRT,maxSqrtPriceX96:MAX_SQRT,deadline:9999999999n,nonce:z};
const b={...a,zeroForOne:false};
process.stdout.write(encodeAbiParameters([{type:'uint256[10][]'},{type:'bytes32'},{type:'bytes32'}],[rows,hashMixedOrder(a),orderSetCommitment([a,b],31337,hook,z)]));
