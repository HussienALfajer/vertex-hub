import { describe, expect, it } from 'vitest';
import { namedFiles, screenshotName } from './held-uploads';

const at = new Date(2026, 9, 26, 14, 5, 9);

describe('screenshotName', () => {
  it('names a screenshot by its local date and time', () => {
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
