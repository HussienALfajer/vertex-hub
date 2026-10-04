import { calendarDateSchema, reportMonthSchema } from '@vertex-hub/contracts';

/*
 * Readers for URL search params. Each returns the value when it is well formed, else undefined,
 * so a malformed filter in a link is dropped instead of reaching the API (which would refuse
 * the whole request). Every list page builds its `validateSearch` from these.
 */

/** The "any" choice of a filter select; never sent to the API. */
export const ALL = 'all';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trimmed text, cut to `max` characters. */
export const textParam = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

/** A record id. */
export const idParam = (value: unknown): string | undefined =>
  typeof value === 'string' && UUID.test(value) ? value : undefined;

/** A calendar day, `YYYY-MM-DD`. */
export const dayParam = (value: unknown): string | undefined =>
  calendarDateSchema.safeParse(value).success ? (value as string) : undefined;

/** A calendar month, `YYYY-MM`. */
export const monthParam = (value: unknown): string | undefined =>
  reportMonthSchema.safeParse(value).success ? (value as string) : undefined;

/** An on-only flag: `true` (the router parses it) or the text "true". */
export const flagParam = (value: unknown): true | undefined =>
  value === true || value === 'true' ? true : undefined;

/** One of `known`. */
export const oneOfParam = <T extends string>(known: readonly T[], value: unknown): T | undefined =>
  known.find((item) => item === value);

/** The items of `known` the list holds, in `known`'s order; undefined when none. */
export function listParam<T extends string>(known: readonly T[], value: unknown): T[] | undefined {
  const picked = Array.isArray(value) ? known.filter((item) => value.includes(item)) : [];
  return picked.length > 0 ? picked : undefined;
}

/** A page after the first; the first page is the default and stays out of the URL. */
export function pageParam(value: unknown): number | undefined {
  const page = Number(value);
  return Number.isInteger(page) && page > 1 ? page : undefined;
}
