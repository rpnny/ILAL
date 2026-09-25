/** Exact integer reference model. Q192 division is always floor; dust remains input. */
export const Q192 = 1n << 192n;
export const MAX_AMOUNT = (1n << 127n) - 1n;
export const MIN_SQRT = 78833030112140176575862854579n;
export const MAX_SQRT = 79625275426524748796330556128n;
export interface MatchingBudget { total0: bigint; total1: bigint; matched0: bigint; matched1: bigint }
export function matchingBudget(total0: bigint, total1: bigint, sqrtPriceX96: bigint): MatchingBudget {
  if (sqrtPriceX96 < MIN_SQRT || sqrtPriceX96 > MAX_SQRT) throw new Error('PRICE');
  if (total0 <= 0n || total1 <= 0n || total0 > MAX_AMOUNT || total1 > MAX_AMOUNT) throw new Error('TOTALS');
  const n = sqrtPriceX96 * sqrtPriceX96;
  const converted = total1 * Q192 / n;
  const matched0 = total0 < converted ? total0 : converted;
  const matched1 = matched0 * n / Q192;
  if (!matched0 || !matched1) throw new Error('NO_MATCH');
  return { total0, total1, matched0, matched1 };
}
export function allocateMatch(b: MatchingBudget, zeroForOne: boolean, cumulative: bigint, amount: bigint) {
  const total = zeroForOne ? b.total0 : b.total1;
  const matched = zeroForOne ? b.matched0 : b.matched1;
  const output = zeroForOne ? b.matched1 : b.matched0;
  if (cumulative < 0n || amount <= 0n || cumulative + amount > total) throw new Error('ALLOCATION');
  const before = cumulative * matched / total, after = (cumulative + amount) * matched / total;
  const matchedInput = after - before;
  const matchedOutput = after * output / matched - before * output / matched;
  if (matchedInput && !matchedOutput) throw new Error('ZERO_MATCHED_OUTPUT');
  return { matchedInput, matchedOutput, residual: amount - matchedInput };
}
