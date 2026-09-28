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
