import { z } from 'zod';

/** Paging parameters every list endpoint takes (ADR 0013). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** The response of a list endpoint; give the result its own `.meta({ id })`. */
export function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

export const sortOrderSchema = z.enum(['asc', 'desc']).meta({ id: 'SortOrder' });

/** A `true`/`false` query parameter. */
export const queryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/** A query parameter that may repeat (`?status=a&status=b`); one value is a list of one. */
export function queryListSchema<Item extends z.ZodType>(item: Item) {
  return z
    .union([item, z.array(item)])
    .transform((value) => (Array.isArray(value) ? value : [value]) as z.output<Item>[]);
}
