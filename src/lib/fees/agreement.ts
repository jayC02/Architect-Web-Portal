import { Prisma } from '@prisma/client';
/** Reject excess precision rather than silently rounding a contract amount. */
export function moneyDecimal(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with at most two decimal places.');
  const amount = new Prisma.Decimal(text);
  if (amount.lte(0) || amount.gt(10_000_000)) throw new Error('Amount must be greater than zero and no more than 10,000,000.');
  return amount;
}
/** Largest remainder allocation is stable by original row order. */
export function allocatePercentages(total: string, percentages: Array<string | number>) {
  const amount = moneyDecimal(total);
  const weights = percentages.map(value => new Prisma.Decimal(value));
  if (weights.some(weight => weight.lte(0) || weight.gt(100)) || !weights.reduce((sum, weight) => sum.plus(weight), new Prisma.Decimal(0)).equals(100)) throw new Error('Percentages must add up to 100.');
  const pennies = amount.times(100);
  const exact = weights.map(weight => pennies.times(weight).div(100));
  const allocated = exact.map(value => value.floor());
  const remainder = pennies.minus(allocated.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0))).toNumber();
  const order = exact.map((value, index) => ({ index, remainder: value.minus(allocated[index]) })).sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (let i = 0; i < remainder; i++) allocated[order[i].index] = allocated[order[i].index].plus(1);
  return allocated.map(value => value.div(100).toFixed(2));
}
export function scheduleReconciles(agreed: string | null, milestones: Array<{ amount: { toString(): string }; enabled: boolean; state?: string }>) {
  if (agreed === null) return null;
  const active = milestones.filter(row => row.enabled && row.state !== 'WAIVED');
  if (!active.length) return true;
  return active.reduce((sum, row) => sum.plus(row.amount.toString()), new Prisma.Decimal(0)).equals(agreed);
}

export function agreementTaxMatches(treatment: string, rate: string | null, effectiveRate: number | string | undefined) {
  if (treatment === 'LEGACY_UNKNOWN' || effectiveRate === undefined) return false;
  const expected = treatment === 'STANDARD' ? rate : '0';
  return expected !== null && new Prisma.Decimal(expected).equals(effectiveRate);
}
