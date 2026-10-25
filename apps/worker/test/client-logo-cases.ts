import { Logger } from '@nestjs/common';
import { expect, vi } from 'vitest';

/** A 1 × 1 PNG: the client's logo of the F01C template cases (rule 14). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export const LOGO = `data:image/png;base64,${PNG.toString('base64')}`;

/** The tile beside the client's name, once. */
export function expectLogo(html: string): void {
  expect(html.split(`<img class="client-logo" src="${LOGO}"`)).toHaveLength(2);
}

export function expectNoLogo(html: string): void {
  expect(html).not.toContain('<img class="client-logo"');
}

/** Rule 14: a logo file that is gone renders the PDF without it and logs the key. */
export async function expectMissingLogoLogged(
  render: (clientLogoKey: string) => Promise<{ file: unknown }>,
): Promise<void> {
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  try {
    const key = 'objects/2026/10/0190a3c2-0000-7000-8000-00000000dead.md.webp';
    const result = await render(key);
    expect(result.file).not.toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(key));
  } finally {
    warn.mockRestore();
  }
}
