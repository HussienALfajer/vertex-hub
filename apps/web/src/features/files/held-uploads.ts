import { formatFileTimestamp } from '../../lib/format';

/*
 * F06B rules B2 and C3: files dropped, pasted or chosen are uploaded at once and held until the
 * comment, question or task that takes them is saved. A screenshot pasted from the clipboard has
 * no name of its own and becomes `Screenshot <date time>.png`.
 */

/** The browser's name for an image pasted from the clipboard, in the browsers we support. */
const CLIPBOARD_IMAGE_NAMES = new Set(['image.png', 'image.jpeg', 'image.jpg', 'image.gif']);

/** `Screenshot 2026-10-26 14.05.09.png`: the date and time in Asia/Damascus, Latin digits. */
export function screenshotName(at: Date, extension = 'png'): string {
  return `Screenshot ${formatFileTimestamp(at)}.${extension}`;
}

/**
 * The files a paste or a drop brings, a pasted screenshot renamed. An empty list means the
 * clipboard held a file reference the browser cannot read (edge case 18: "Nothing to paste").
 */
export function namedFiles(files: readonly File[], at: Date, pasted: boolean): File[] {
  return files.map((file) => {
    if (!pasted || !(file.name === '' || CLIPBOARD_IMAGE_NAMES.has(file.name))) return file;
    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    return new File([file], screenshotName(at, extension), {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

/** What a paste event carries, as `pastedFiles` reads it. */
export interface PasteLike {
  defaultPrevented: boolean;
  target: EventTarget | null;
  clipboardData: { files: ArrayLike<File>; types: readonly string[] } | null;
}

/**
 * The files a paste on the page brings, outside a field (a field or an editor takes its own
 * paste). Null when the paste is not a file paste, or not ours: text, or handled already. An empty
 * list is a copied file reference the browser cannot read (edge case 18: "Nothing to paste").
 */
export function pastedFiles(event: PasteLike): File[] | null {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (event.defaultPrevented || target?.closest?.('input, textarea, [contenteditable="true"]')) {
    return null;
  }
  const data = event.clipboardData;
  if (!data) return null;
  const files = Array.from(data.files);
  if (files.length > 0) return files;
  return data.types.includes('Files') ? [] : null;
}
