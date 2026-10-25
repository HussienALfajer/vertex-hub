import {
  type AnnexSnapshot,
  CONTRACT_AGENCY_FIELDS,
  CONTRACT_CLIENT_FIELDS,
  type ContractBlock,
  type ContractSnapshot,
  contractBodyParts,
} from '@vertex-hub/contracts';
import {
  annexAmendmentLines,
  CONTRACT_TEXT,
  contractArticleHeading,
  contractDeliverableName,
  contractFeesCaption,
  contractTermLines,
  fill,
  formatCalendarDate,
  formatMoney,
  formatNumber,
  formatPeriod,
} from '@vertex-hub/messages';
import {
  clientLogoTile,
  documentHtml,
  escapeHtml,
  type TemplateAssets,
  textLines,
} from './document.js';

/*
 * The retainer contract and annex PDFs (spec F05C K6, K10), in the shell of `document.ts` and the
 * layout of the agency's paper contract: the two party tables, the slogan, the preamble, the
 * numbered articles with their generated blocks, the signatures, and on every page the page
 * badge, the footer and "page x of y". Fields left empty print as a line to fill in by hand.
 * The texts outside the articles come from `@vertex-hub/messages` (K11).
 */

const T = CONTRACT_TEXT;

/** A CSS string for a page-margin box: quotes, backslashes and line breaks escaped. */
const cssString = (text: string) =>
  `"${text
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s*\n\s*/g, ' ')}"`;

/** The brand's 60° motif as a row of sand bars (brand/identity.md §5), for the footer. */
const MOTIF = `url("data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="10" viewBox="0 0 60 10">${[
    0, 1, 2, 3, 4,
  ]
    .map(
      (index) =>
        `<polygon points="${index * 12},10 ${index * 12 + 6},0 ${index * 12 + 10},0 ${index * 12 + 4},10" fill="#B9A87A"/>`,
    )
    .join('')}</svg>`,
).toString('base64')}")`;

/**
 * Page-margin boxes (Chromium ≥ 131): the page badge at the top's end, the agency's contacts at
 * the bottom with the motif, and "page x of y".
 */
function pageStyles(footer: string): string {
  const pageOf = fill(T.page, { page: '" counter(page) "', pages: '" counter(pages) "' });
  return `
@page {
  margin: 20mm 16mm 26mm;
  @top-left {
    content: counter(page); width: 9mm; height: 9mm; margin-top: 8mm; text-align: center;
    vertical-align: middle; background: #004139; color: #FFFFFF; font-family: 'Montserrat';
    font-size: 9pt; font-weight: 700; border-radius: 2px;
  }
  @bottom-center {
    content: ${cssString(footer)}; font-family: 'Montserrat', 'Noto Kufi Arabic';
    font-size: 7.5pt; color: #616866; direction: rtl; border-top: 1px solid #D4DBD9;
    vertical-align: top; padding-top: 3mm;
  }
  @bottom-left {
    content: "${pageOf}"; font-family: 'Noto Kufi Arabic'; font-size: 7.5pt; color: #616866;
    direction: rtl; border-top: 1px solid #D4DBD9; vertical-align: top; padding-top: 3mm;
  }
  @bottom-right {
    content: ""; background: ${MOTIF} no-repeat right 3mm; background-size: 60px 10px;
    border-top: 1px solid #D4DBD9;
  }
}
.contract-head { display: flex; justify-content: space-between; align-items: center; margin: 18px 0 6px; }
.contract-head dl { display: grid; grid-template-columns: auto auto; gap: 2px 12px; margin: 0;
  padding: 8px 12px; border: 1px solid #D4DBD9; border-radius: 8px; font-size: 9pt; }
.contract-head dt { color: #616866; }
.contract-head dd { margin: 0; font-weight: 500; }
h1.contract-title { text-align: center; margin: 12px 0 18px; font-size: 20pt; }
.parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px; }
table.party { break-inside: avoid; border: 1px solid #D4DBD9; }
table.party caption { caption-side: top; text-align: start; font-size: 8.5pt; color: #616866; padding-bottom: 4px; }
table.party thead th { background: #004139; color: #FFFFFF; font-weight: 700; text-align: start;
  padding: 6px 8px; font-size: 10pt; }
table.party td { padding: 4px 8px; border-top: 1px solid #E7EFED; font-size: 9pt; vertical-align: top; }
table.party td.label { width: 38%; color: #616866; }
.party-head { display: flex; align-items: center; gap: 8px; }
p.preamble.with-logo { display: flex; align-items: center; gap: 8px; }
.blank { display: inline-block; min-width: 40mm; border-bottom: 1px dotted #616866; height: 1.1em; }
.slogan { text-align: center; color: #004139; font-weight: 700; margin: 14px 0 6px; }
.preamble { margin: 0 0 14px; }
article { margin-bottom: 12px; }
article h3 { margin: 10px 0 4px; font-size: 10.5pt; break-after: avoid; }
article p { margin: 0 0 6px; }
.block { margin: 6px 0 10px; }
.block p { margin: 0 0 2px; }
.signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; break-inside: avoid; }
.signatures section { border: 1px solid #D4DBD9; border-radius: 8px; padding: 10px 12px; margin: 0; }
.signatures h3 { margin: 0 0 8px; }
.signatures p { margin: 0 0 10px; }
.signatures .line { display: inline-block; min-width: 45mm; border-bottom: 1px solid #616866; }
`;
}

/** An amount with its currency (`-1,200.00 USD`), which reads left to right as a whole. */
const MONEY = /([-+]?\d{1,3}(?:,\d{3})*\.\d{2}\s[A-Z]{3})/;

/** A generated line (term, fees, annex), its amounts isolated as `textLines` isolates numbers. */
function sentence(text: string): string {
  return text
    .split(MONEY)
    .map((part, index) =>
      index % 2 === 1 ? `<bdi dir="ltr" class="num">${escapeHtml(part)}</bdi>` : textLines(part),
    )
    .join('');
}

/** A value, or a line to fill in by hand when it is empty. */
function value(text: string | undefined): string {
  return text?.trim() ? textLines(text) : '<span class="blank"></span>';
}

function partyTable(
  caption: string,
  header: string | undefined,
  rows: readonly (readonly [string, string | undefined])[],
  logo: string | null = null,
): string {
  const head = logo
    ? `<span class="party-head">${clientLogoTile(logo)}<span>${value(header)}</span></span>`
    : value(header);
  return `<table class="party">
  <caption>${caption}</caption>
  <thead><tr><th colspan="2">${head}</th></tr></thead>
  <tbody>${rows.map(([label, text]) => `<tr><td class="label">${label}</td><td>${value(text)}</td></tr>`).join('')}</tbody>
</table>`;
}

function servicesBlock(services: ContractSnapshot['services']): string {
  const quote = services.quote
    ? `<p>${escapeHtml(fill(T.services.quote, { number: services.quote.displayNumber }))}</p>
<table class="lines"><thead><tr><th>${T.services.service}</th><th class="narrow">${T.services.quantity}</th></tr></thead>
<tbody>${services.quote.lines
        .map(
          (line) =>
            `<tr><td><div class="line-name">${escapeHtml(line.name)}</div>${line.items
              .map(
                (item) =>
                  `<div class="description">${escapeHtml(item.name)} × <span class="num">${formatNumber(item.quantity)}</span></div>`,
              )
              .join('')}</td><td class="num">${formatNumber(line.quantity)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '';
  const lines = services.deliverables.length
    ? `<p>${T.services.deliverables}</p>
<table class="lines"><thead><tr><th>${T.services.item}</th><th class="money">${T.services.perCycle}</th><th class="money">${T.services.revisions}</th></tr></thead>
<tbody>${services.deliverables
        .map(
          (line) =>
            `<tr><td>${escapeHtml(contractDeliverableName(line))}</td><td class="num">${formatNumber(line.quantity)}</td><td class="num">${line.revisionLimit === null ? '—' : formatNumber(line.revisionLimit)}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : `<p>${T.services.none}</p>`;
  return `<div class="block">${quote}${lines}</div>`;
}

function termBlock(term: ContractSnapshot['term']): string {
  return `<div class="block">${contractTermLines(term)
    .map((line) => `<p>${sentence(line)}</p>`)
    .join('')}</div>`;
}

function scheduleTable(
  rows: readonly { cycle: number; periodStart: string; periodEnd: string; amountMinor: number }[],
  currency: ContractSnapshot['fees']['currency'],
): string {
  if (rows.length === 0) return '';
  return `<table class="lines"><thead><tr><th class="narrow">${T.fees.cycle}</th><th>${T.fees.period}</th><th class="money">${T.fees.amount}</th></tr></thead>
<tbody>${rows
    .map(
      (row) =>
        `<tr><td class="num">${formatNumber(row.cycle)}</td><td>${escapeHtml(formatPeriod(row.periodStart, row.periodEnd))}</td><td class="num">${formatMoney(row.amountMinor, currency)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function feesBlock(fees: ContractSnapshot['fees']): string {
  return `<div class="block"><p>${sentence(contractFeesCaption(fees))}</p>${scheduleTable(fees.schedule, fees.currency)}</div>`;
}

/** A block placeholder's generated content (K7). */
function blockHtml(block: ContractBlock, snapshot: ContractSnapshot): string {
  switch (block) {
    case 'services':
      return servicesBlock(snapshot.services);
    case 'term':
      return termBlock(snapshot.term);
    case 'fees':
      return feesBlock(snapshot.fees);
  }
}

function articleHtml(article: ContractSnapshot['articles'][number], snapshot: ContractSnapshot) {
  const parts = contractBodyParts(article.body)
    .map((part) =>
      'text' in part ? `<p>${textLines(part.text)}</p>` : blockHtml(part.block, snapshot),
    )
    .join('');
  return `<article><h3>${escapeHtml(contractArticleHeading(article))}</h3>${parts}</article>`;
}

function signatures(
  agency: { name: string; title: string },
  client: { name: string; title: string },
): string {
  const side = (heading: string, party: { name: string; title: string }) => `<section>
  <h3>${heading}</h3>
  <p>${T.signatures.name}: ${value(party.name)}</p>
  <p>${T.signatures.title}: ${value(party.title)}</p>
  <p>${T.signatures.signature}: <span class="line">&nbsp;</span></p>
  <p>${T.signatures.stamp}: <span class="line">&nbsp;</span></p>
</section>`;
  return `<div class="signatures">${side(T.firstParty, agency)}${side(T.secondParty, client)}</div>`;
}

const footerOf = (agency: { website: string; address: string; phone: string }) =>
  [agency.website, agency.address, agency.phone].filter((text) => text.trim()).join('  |  ');

/** An issued contract, or a draft preview (no number, a "draft" watermark). */
export function contractHtml(snapshot: ContractSnapshot, assets: TemplateAssets): string {
  const { agency, client } = snapshot;
  const number = snapshot.displayNumber;
  const agencyRows = CONTRACT_AGENCY_FIELDS.filter(
    (field) => field !== 'legalName' && field !== 'website',
  ).map((field) => [T.agencyFields[field], agency[field]] as const);
  const clientRows = CONTRACT_CLIENT_FIELDS.filter((field) => field !== 'signatoryName').map(
    (field) => [T.clientFields[field], client[field]] as const,
  );
  const body = `<div class="contract-head">
  <dl>
    <dt>${T.date}</dt><dd class="num">${escapeHtml(formatCalendarDate(snapshot.contractDate))}</dd>
    <dt>${T.number}</dt><dd class="num">${number ? escapeHtml(number) : '<span class="blank"></span>'}</dd>
  </dl>
</div>
<div class="title"><h1 class="contract-title">${T.title}</h1></div>
<div class="parties">
  ${partyTable(T.firstParty, agency.legalName, agencyRows)}
  ${partyTable(T.secondParty, client.signatoryName, clientRows, assets.clientLogo)}
</div>
${snapshot.slogan.trim() ? `<p class="slogan">${escapeHtml(snapshot.slogan)}</p>` : ''}
<p class="preamble">${T.preamble}</p>
${snapshot.articles.map((article) => articleHtml(article, snapshot)).join('')}
${signatures(
  { name: agency.representativeName, title: agency.representativeTitle },
  { name: client.signatoryName, title: client.title },
)}`;
  return documentHtml({
    title: number ?? T.title,
    companyDetails: '',
    body,
    assets,
    watermark: number ? undefined : T.draft,
    styles: pageStyles(footerOf(agency)),
  });
}

/** An annex of a contract (K10). */
export function annexHtml(snapshot: AnnexSnapshot, assets: TemplateAssets): string {
  const { agency, client, amendment } = snapshot;
  const title = fill(T.annex.title, {
    annex: formatNumber(snapshot.annexNumber),
    contract: snapshot.contractNumber,
  });
  const body = `<div class="contract-head">
  <dl>
    <dt>${T.annex.date}</dt><dd class="num">${escapeHtml(formatCalendarDate(snapshot.annexDate))}</dd>
    <dt>${T.number}</dt><dd class="num">${escapeHtml(snapshot.contractNumber)}</dd>
  </dl>
</div>
<div class="title"><h1 class="contract-title">${escapeHtml(title)}</h1></div>
<p class="preamble${assets.clientLogo ? ' with-logo' : ''}">${clientLogoTile(assets.clientLogo)}<span>${textLines(fill(T.annex.parties, { agency: agency.tradeName || agency.legalName, client: client.tradeName }))}</span></p>
<p class="preamble">${T.annex.intro}</p>
<article>${annexAmendmentLines(amendment)
    .map((line) => `<p>${sentence(line)}</p>`)
    .join(
      '',
    )}${amendment.schedule ? scheduleTable(amendment.schedule, amendment.currency) : ''}</article>
<p>${T.annex.closing}</p>
${signatures(
  { name: agency.representativeName, title: agency.representativeTitle },
  { name: client.signatoryName, title: client.title },
)}`;
  return documentHtml({
    title,
    companyDetails: '',
    body,
    assets,
    styles: pageStyles(footerOf(agency)),
  });
}
