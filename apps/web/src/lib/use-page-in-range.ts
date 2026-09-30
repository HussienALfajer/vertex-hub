import { useEffect } from 'react';

/**
 * Keeps a paged list on a page that exists. A page past the end (its last records archived or
 * finished elsewhere, or an old link) moves to the last page, so the list never shows "no
 * records" with no way back while records exist.
 */
export function usePageInRange(
  page: number,
  total: number | undefined,
  pageSize: number,
  goToPage: (page: number | undefined) => void,
): void {
  useEffect(() => {
    if (total === undefined || page <= 1) return;
    const last = Math.max(1, Math.ceil(total / pageSize));
    if (page > last) goToPage(last > 1 ? last : undefined);
  }, [page, total, pageSize, goToPage]);
}
