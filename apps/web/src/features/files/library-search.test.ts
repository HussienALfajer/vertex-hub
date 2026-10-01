import { describe, expect, it } from 'vitest';
import { parseFileLibrarySearch, recentMonths } from './library-search';

describe('recentMonths', () => {
  it('counts back from the month, across the year', () => {
    expect(recentMonths('2026-02', 4)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11']);
  });
});

describe('parseFileLibrarySearch', () => {
  it('keeps well-formed filters', () => {
    expect(
      parseFileLibrarySearch({
        fileType: 'image',
        fileMonth: '2026-10',
        fileQ: ' poster ',
        filePage: 2,
      }),
    ).toEqual({ fileType: 'image', fileMonth: '2026-10', fileQ: 'poster', filePage: 2 });
  });

  it('drops malformed ones', () => {
    expect(
      parseFileLibrarySearch({ fileType: 'psd', fileMonth: '2026-13', fileQ: '  ', filePage: 1 }),
    ).toEqual({
      fileType: undefined,
      fileMonth: undefined,
      fileQ: undefined,
      filePage: undefined,
    });
  });
});
