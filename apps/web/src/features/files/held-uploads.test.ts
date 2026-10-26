import { describe, expect, it } from 'vitest';
import { namedFiles, pastedFiles, screenshotName } from './held-uploads';

// 11:05:09 UTC is 14:05:09 in Asia/Damascus (UTC+3), whatever the machine's time zone.
const at = new Date('2026-10-26T11:05:09Z');

describe('screenshotName', () => {
  it('names a screenshot by its date and time in Damascus', () => {
    expect(screenshotName(at)).toBe('Screenshot 2026-10-26 14.05.09.png');
  });
});

describe('namedFiles', () => {
  it('renames an image pasted from the clipboard', () => {
    const [file] = namedFiles([new File(['x'], 'image.png', { type: 'image/png' })], at, true);
    expect(file?.name).toBe('Screenshot 2026-10-26 14.05.09.png');
    expect(file?.type).toBe('image/png');
  });

  it('keeps the jpeg type and gives it a jpg name', () => {
    const [file] = namedFiles([new File(['x'], 'image.jpeg', { type: 'image/jpeg' })], at, true);
    expect(file?.name).toBe('Screenshot 2026-10-26 14.05.09.jpg');
  });

  it('keeps the name of a pasted file that has one', () => {
    const [file] = namedFiles(
      [new File(['x'], 'brief.pdf', { type: 'application/pdf' })],
      at,
      true,
    );
    expect(file?.name).toBe('brief.pdf');
  });

  it('never renames a dropped file', () => {
    const [file] = namedFiles([new File(['x'], 'image.png', { type: 'image/png' })], at, false);
    expect(file?.name).toBe('image.png');
  });
});

describe('pastedFiles', () => {
  const image = new File(['x'], 'image.png', { type: 'image/png' });
  const page = { closest: () => null };
  const field = { closest: () => ({}) };
  const paste = (
    files: File[],
    types: string[],
    target: object = page,
    defaultPrevented = false,
  ) => ({
    defaultPrevented,
    target: target as EventTarget,
    clipboardData: { files, types },
  });

  it('takes the files pasted on the page', () => {
    expect(pastedFiles(paste([image], ['Files']))).toEqual([image]);
  });

  it('leaves a paste in a field or an editor to it', () => {
    expect(pastedFiles(paste([image], ['Files'], field))).toBeNull();
  });

  it('leaves a paste another handler took', () => {
    expect(pastedFiles(paste([image], ['Files'], page, true))).toBeNull();
  });

  it('ignores pasted text', () => {
    expect(pastedFiles(paste([], ['text/plain']))).toBeNull();
  });

  it('reports a file reference the browser cannot read as nothing to paste', () => {
    expect(pastedFiles(paste([], ['Files', 'text/uri-list']))).toEqual([]);
  });
});
