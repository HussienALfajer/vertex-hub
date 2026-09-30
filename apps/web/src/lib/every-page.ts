/** Every item of a paged list, page after page, for lookups that must not stop at one page. */
export async function everyPage<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; total: number; pageSize: number }>,
): Promise<T[]> {
  const first = await fetchPage(1);
  const pages = Math.ceil(first.total / first.pageSize);
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, pages - 1) }, (_, index) => fetchPage(index + 2)),
  );
  return [first, ...rest].flatMap((page) => page.items);
}
