import type { Currency } from '@vertex-hub/contracts';

/*
 * The shell of every PDF the worker renders (quotes F04, invoices, receipts and statements F13):
 * an Arabic RTL A4 document in the brand (brand/identity.md: green full logo on white, Vertex
 * Green structure, sand accents, 1 px borders). The PDFs are Arabic only (owner decision), so
 * their labels live in the templates rather than in i18next.
 */

/** Both V1 currencies use 2 decimal places (ADR 0006); the web app formats them the same way. */
const MINOR_PER_UNIT = 100;
const LOCALE = 'ar-SY-u-nu-latn';

export interface TemplateAssets {
  /** The green full logo, an SVG data URL. */
  logo: string;
  /** `@font-face` rules with embedded fonts. */
  fontFaces: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / MINOR_PER_UNIT);
}

/** A titled block of free text (notes, terms, payment details); nothing when empty. */
export function textBlock(title: string, text: string | null): string {
  if (!text?.trim()) return '';
  return `<section class="text"><h3>${title}</h3><p>${escapeHtml(text)}</p></section>`;
}

/** A `dl.meta` entry; `num` for dates and numbers, which read left to right. */
export function metaItem(label: string, value: string, options: { num?: boolean } = {}): string {
  return `<div><dt>${label}</dt><dd${options.num ? ' class="num"' : ''}>${escapeHtml(value)}</dd></div>`;
}

const STYLES = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Montserrat', 'Noto Kufi Arabic', sans-serif;
  font-size: 10pt; line-height: 1.7; color: #222827; background: #FFFFFF;
}
/* Numbers read left to right, aligned with their (right-aligned) Arabic headers. */
.num { font-variant-numeric: tabular-nums; direction: ltr; unicode-bidi: isolate; text-align: end; white-space: nowrap; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
  padding-bottom: 12px; border-bottom: 2px solid #004139; }
header img { width: auto; height: 72px; }
.company { margin: 0; font-size: 8.5pt; color: #616866; white-space: pre-line; text-align: end; }
.title { display: flex; align-items: center; gap: 10px; margin: 20px 0 4px; }
.title::before { content: ''; width: 5px; height: 26px; background: #B9A87A; transform: skewX(-30deg); }
h1 { margin: 0; font-size: 18pt; font-weight: 700; color: #004139; }
h1 .version { font-size: 11pt; font-weight: 500; color: #616866; }
dl.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 24px; margin: 0 0 18px;
  padding: 10px 14px; border: 1px solid #D4DBD9; border-radius: 8px; }
dl.meta dt { font-size: 8pt; color: #616866; }
dl.meta dd { margin: 0; font-weight: 500; white-space: pre-line; }
section { margin-bottom: 18px; break-inside: auto; }
h2 { margin: 0 0 8px; font-size: 12pt; font-weight: 700; color: #004139; }
h3 { margin: 12px 0 6px; font-size: 10pt; font-weight: 700; color: #004139; }
table { width: 100%; border-collapse: collapse; }
table.lines th { background: #F4F8F7; color: #353B39; font-size: 8.5pt; font-weight: 500;
  text-align: start; padding: 6px 8px; border-bottom: 1px solid #D4DBD9; }
table.lines td { padding: 7px 8px; border-bottom: 1px solid #E7EFED; vertical-align: top; }
table.lines tr { break-inside: avoid; }
th.narrow { width: 12%; }
th.money { width: 20%; }
.line-name { font-weight: 500; }
.description { font-size: 8.5pt; color: #616866; white-space: pre-line; }
table.sums { width: 45%; margin-inline-start: auto; margin-top: 6px; break-inside: avoid; }
table.sums th { text-align: start; font-weight: 400; color: #616866; padding: 3px 8px; }
table.sums td { padding: 3px 8px; }
table.sums td.amount { text-align: start; white-space: nowrap; }
table.sums tr.net th, table.sums tr.net td { font-weight: 700; color: #004139;
  border-top: 1px solid #D4DBD9; padding-top: 6px; }
.text p { margin: 0; white-space: pre-line; font-size: 9pt; }
footer.note { margin-top: 24px; padding-top: 8px; border-top: 1px solid #D4DBD9;
  font-size: 8.5pt; color: #616866; white-space: pre-line; }
.watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 10; }
.watermark span { font-size: 120pt; font-weight: 700; color: rgba(185, 168, 122, 0.22);
  transform: rotate(-30deg); }
`;

/**
 * The whole page: the brand header with the company details, an optional "draft" watermark, the
 * template's body and its own styles.
 */
export function documentHtml(input: {
  title: string;
  companyDetails: string;
  body: string;
  assets: TemplateAssets;
  /** The watermark text of a draft preview. */
  watermark?: string;
  styles?: string;
}): string {
  const company = input.companyDetails.trim()
    ? `<p class="company">${escapeHtml(input.companyDetails)}</p>`
    : '';
  const watermark = input.watermark
    ? `<div class="watermark"><span>${input.watermark}</span></div>`
    : '';
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
${input.assets.fontFaces}
${STYLES}
${input.styles ?? ''}
</style>
</head>
<body>
${watermark}
<header>
  <img src="${input.assets.logo}" alt="Vertex Media">
  ${company}
</header>
${input.body}
</body>
</html>`;
}
