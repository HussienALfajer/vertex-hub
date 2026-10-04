import { addDays } from '@vertex-hub/contracts';

/** Rule 9: the 7 days ending yesterday, cut at the start of yesterday's month. */
export function defaultPeriod(today: string): { periodStart: string; periodEnd: string } {
  const periodEnd = addDays(today, -1);
  const weekStart = addDays(periodEnd, -6);
  const monthStart = `${periodEnd.slice(0, 7)}-01`;
  return { periodEnd, periodStart: weekStart < monthStart ? monthStart : weekStart };
}
