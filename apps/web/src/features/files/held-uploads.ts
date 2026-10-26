/*
 * F06B rules B2 and C3: files dropped, pasted or chosen are uploaded at once and held until the
 * comment, question or task that takes them is saved. A screenshot pasted from the clipboard has
 * no name of its own and becomes `Screenshot <date time>.png`.
 */

/** The browser's name for an image pasted from the clipboard, in the browsers we support. */
const CLIPBOARD_IMAGE_NAMES = new Set(['image.png', 'image.jpeg', 'image.jpg', 'image.gif']);

/** `Screenshot 2026-10-26 14.05.09.png`: the local date and time, Latin digits. */
export function screenshotName(at: Date, extension = 'png'): string {
  const pad = (value: number) => value.toString().padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  return `Screenshot ${date} ${time}.${extension}`;
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
