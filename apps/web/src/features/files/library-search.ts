import { FILE_TYPES, type FileType, fileMonthSchema } from '@vertex-hub/contracts';
import { oneOfParam, pageParam, textParam } from '../../lib/search-params';

/** The library's filters, kept in the profile's URL next to its tab. */
export interface FileLibrarySearch {
  fileType?: FileType;
  /** `YYYY-MM`. */
  fileMonth?: string;
  fileQ?: string;
  filePage?: number;
}

export function parseFileLibrarySearch(search: Record<string, unknown>): FileLibrarySearch {
  return {
    fileType: oneOfParam(FILE_TYPES, search.fileType),
    fileMonth: fileMonthSchema.safeParse(search.fileMonth).success
      ? (search.fileMonth as string)
      : undefined,
    fileQ: textParam(search.fileQ, 120),
    filePage: pageParam(search.filePage),
  };
}

/** `count` months, newest first, ending at `month` (`YYYY-MM`). */
export function recentMonths(month: string, count: number): string[] {
  const [year, index] = month.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, back) => {
    const date = new Date(Date.UTC(year, index - 1 - back, 1));
    return date.toISOString().slice(0, 7);
  });
}
