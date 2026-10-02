import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import type { QuoteSnapshot } from '@vertex-hub/contracts';
import { chromium } from 'playwright';
import { type QuoteTemplateAssets, quoteHtml } from './quote-template.js';

const require = createRequire(import.meta.url);

/**
 * The fallback fonts (brand/identity.md §3, Q11): Noto Kufi Arabic for Arabic, Montserrat for
 * Latin letters and digits. Embedded in the page, so Chromium needs no installed fonts.
 */
const FONTS = [
  { family: 'Noto Kufi Arabic', pkg: '@fontsource/noto-kufi-arabic', subset: 'arabic' },
  { family: 'Montserrat', pkg: '@fontsource/montserrat', subset: 'latin' },
] as const;

const WEIGHTS = [400, 500, 700] as const;

/** The document logo (brand/identity.md §7): green full logo on white. */
const LOGO = 'brand/logo/svg/vertex-logo-green.svg';

/** The repository root, where `brand/` lives, from this file in `src/` or `dist/`. */
function repositoryRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('The repository root (pnpm-workspace.yaml) was not found');
    dir = parent;
  }
  return dir;
}

async function loadAssets(): Promise<QuoteTemplateAssets> {
  const faces: string[] = [];
  for (const font of FONTS) {
    const files = join(dirname(require.resolve(`${font.pkg}/package.json`)), 'files');
    const name = font.pkg.split('/')[1];
    for (const weight of WEIGHTS) {
      const bytes = await readFile(join(files, `${name}-${font.subset}-${weight}-normal.woff2`));
      faces.push(
        `@font-face { font-family: '${font.family}'; font-weight: ${weight}; font-style: normal;
  src: url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2'); }`,
      );
    }
  }
  const logo = await readFile(join(repositoryRoot(), LOGO));
  return {
    fontFaces: faces.join('\n'),
    logo: `data:image/svg+xml;base64,${logo.toString('base64')}`,
  };
}

/**
 * Renders quote PDFs with Chromium (ADR 0008). One browser per render: renders are rare, and
 * the memory goes back to the server between them (Q7).
 */
@Injectable()
export class PdfRenderer {
  private assets: Promise<QuoteTemplateAssets> | undefined;

  async quote(snapshot: QuoteSnapshot, options: { draft: boolean }): Promise<Buffer> {
    this.assets ??= loadAssets();
    const html = quoteHtml(snapshot, options, await this.assets);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      // Everything is inline: the page loads nothing from the network.
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html, { waitUntil: 'load' });
      // A string: the worker is compiled without the DOM types.
      await page.evaluate('document.fonts.ready.then(() => true)');
      return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close();
    }
  }
}
