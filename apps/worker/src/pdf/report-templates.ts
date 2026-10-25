import {
  CYCLE_REPORT_LABELS as C,
  type ClientReportSnapshot,
  type CycleReportSnapshot,
  CLIENT_REPORT_LABELS as L,
  responseTimeText,
  REPORT_VALUE_LABELS as VALUES,
} from '@vertex-hub/contracts';
import { formatRetainerCycle } from '@vertex-hub/messages';
import {
  clientLogoTile,
  documentHtml,
  escapeHtml,
  formatMoney,
  type TemplateAssets,
  textBlock,
} from './document.js';

/*
 * The monthly client report (spec F15 rules 18 and 20) and the retainer cycle report (F05C R2),
 * in the shell of `document.ts`. Each prints its payload only: each section with data, in the
 * order of rule 18.
 */

const monthName = new Intl.DateTimeFormat('ar-SY-u-nu-latn', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const usd = (minor: number) => formatMoney(minor, 'USD');

/** Counts with thousands separators, as money prints (reach runs into the tens of thousands). */
const countFormat = new Intl.NumberFormat('ar-SY-u-nu-latn');
const count = (value: number) => countFormat.format(value);

const cell = (value: string | number | null, options: { num?: boolean } = {}) =>
  `<td${options.num ? ' class="num"' : ''}>${value === null ? '—' : escapeHtml(String(value))}</td>`;

function table(headers: { label: string; num?: boolean }[], rows: string[]): string {
  const head = headers
    .map((header) => `<th${header.num ? ' class="narrow"' : ''}>${header.label}</th>`)
    .join('');
  return `<table class="lines"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const section = (title: string, content: string) =>
  `<section><h2>${title}</h2>${content}</section>`;

export function clientReportHtml(snapshot: ClientReportSnapshot, assets: TemplateAssets): string {
  const month = monthName.format(new Date(`${snapshot.period.from}T00:00:00Z`));
  const parts: string[] = [];
  if (snapshot.summary) parts.push(textBlock(L.summary, snapshot.summary.text));
  for (const retainer of snapshot.retainers) {
    parts.push(
      section(
        // F05C R4: each cycle overlapping the month, with its period.
        `${L.retainers}: ${escapeHtml(retainer.retainer.name)} — ${escapeHtml(formatRetainerCycle({ number: retainer.cycle, periodStart: retainer.periodStart, periodEnd: retainer.periodEnd }))}`,
        linesTable(retainer.lines, L.completion, retainer.completion),
      ),
    );
  }
  if (snapshot.projects.length) {
    parts.push(
      section(
        L.projects,
        table(
          [
            { label: L.project },
            { label: L.status },
            { label: L.progress, num: true },
            { label: L.milestonesDone },
          ],
          snapshot.projects.map(
            (project) =>
              `<tr>${cell(project.project.name)}${cell(VALUES.projectStatuses[project.status])}${cell(project.totalTasks === 0 ? null : `${count(project.deliveredTasks)} / ${count(project.totalTasks)}`, { num: true })}${cell(project.milestonesDone.map((m) => m.name).join('، ') || null)}</tr>`,
          ),
        ),
      ),
    );
  }
  parts.push(
    ...activitySections(snapshot, snapshot.nextMonth, {
      opening: L.opening,
      closing: L.closing,
      next: L.nextMonth,
    }),
  );
  return reportDocument(snapshot, assets, {
    title: L.title,
    subtitle: month,
    name: snapshot.client.name,
    documentTitle: `${L.title} ${snapshot.client.name} ${snapshot.month}`,
    preliminary: L.preliminary,
    noActivity: L.noActivity,
    parts,
  });
}

/** F05C R2: the cycle report, as the monthly one with this cycle's lines and no projects. */
export function cycleReportHtml(snapshot: CycleReportSnapshot, assets: TemplateAssets): string {
  const parts: string[] = [];
  if (snapshot.summary) parts.push(textBlock(C.summary, snapshot.summary.text));
  if (snapshot.lines.length) {
    parts.push(
      section(C.deliverables, linesTable(snapshot.lines, C.deliveryRate, snapshot.deliveryRate)),
    );
  }
  parts.push(
    ...activitySections(snapshot, snapshot.nextPeriod, {
      opening: C.opening,
      closing: C.closing,
      next: C.nextPeriod,
    }),
  );
  const cycle = formatRetainerCycle({
    number: snapshot.cycle.number,
    periodStart: snapshot.period.from,
    periodEnd: snapshot.period.to,
  });
  return reportDocument(snapshot, assets, {
    title: C.title,
    subtitle: cycle,
    name: `${snapshot.client.name} — ${snapshot.retainer.name}`,
    documentTitle: `${C.title} ${snapshot.client.name} ${snapshot.retainer.name} ${snapshot.cycle.number}`,
    preliminary: C.preliminary,
    noActivity: C.noActivity,
    parts,
  });
}

type ReportLines = ClientReportSnapshot['retainers'][number]['lines'];

/** A cycle's lines with their counts and percents, then the total rate. */
function linesTable(lines: ReportLines, totalLabel: string, total: number | null): string {
  return table(
    [
      { label: L.kind },
      { label: L.committed, num: true },
      { label: L.delivered, num: true },
      { label: L.percent, num: true },
    ],
    [
      ...lines.map(
        (line) =>
          `<tr>${cell(line.label ?? VALUES.deliverableKinds[line.kind])}${cell(count(line.committed), { num: true })}${cell(line.delivered === null ? null : count(line.delivered), { num: true })}${cell(line.percent === null ? null : `${line.percent}%`, { num: true })}</tr>`,
      ),
      `<tr class="total">${cell(totalLabel)}<td></td><td></td>${cell(total === null ? null : `${total}%`, { num: true })}</tr>`,
    ],
  );
}

type Activity = Pick<
  ClientReportSnapshot,
  'deliveredWork' | 'posts' | 'shoots' | 'approvals' | 'campaigns' | 'adBudget'
>;

/**
 * The sections both client reports share (F15 rule 18.4–18.10, F05C R2), each with data;
 * `labels` name the period they cover.
 */
function activitySections(
  sections: Activity,
  next: ClientReportSnapshot['nextMonth'],
  labels: { opening: string; closing: string; next: string },
): string[] {
  const parts: string[] = [];
  if (sections.deliveredWork.length) {
    parts.push(
      section(
        L.deliveredWork,
        table(
          [{ label: L.date, num: true }, { label: L.work }, { label: L.department }],
          sections.deliveredWork.map(
            (work) =>
              `<tr>${cell(work.deliveredOn, { num: true })}${cell(work.title)}${cell(work.departmentName)}</tr>`,
          ),
        ),
      ),
    );
  }
  if (sections.posts.length) {
    parts.push(
      section(
        L.posts,
        table(
          [{ label: L.date, num: true }, { label: L.postTitle }, { label: L.platforms }],
          sections.posts.map((post) => {
            const links = post.links
              .map((link) => `<div class="description num">${escapeHtml(link.url)}</div>`)
              .join('');
            return `<tr>${cell(post.publishedOn, { num: true })}<td>${escapeHtml(post.title)}${links}</td>${cell(post.platforms.map((p) => VALUES.postPlatforms[p]).join('، '))}</tr>`;
          }),
        ),
      ),
    );
  }
  if (sections.shoots.length) {
    parts.push(
      section(
        L.shoots,
        table(
          [{ label: L.date, num: true }, { label: L.shoot }, { label: L.location }],
          sections.shoots.map(
            (shoot) =>
              `<tr>${cell(shoot.date, { num: true })}${cell(shoot.title)}${cell(shoot.location)}</tr>`,
          ),
        ),
      ),
    );
  }
  const approvals = sections.approvals;
  if (approvals.approved + approvals.changesRequested > 0) {
    parts.push(
      section(
        L.approvals,
        `<table class="sums wide">
  <tr><th>${L.approved}</th><td class="num">${count(approvals.approved)}</td></tr>
  <tr><th>${L.changesRequested}</th><td class="num">${count(approvals.changesRequested)}</td></tr>
  ${approvals.averageResponseHours === null ? '' : `<tr><th>${L.averageResponse}</th><td>${responseTimeText(approvals.averageResponseHours)}</td></tr>`}
</table>`,
      ),
    );
  }
  if (sections.campaigns?.rows.length) {
    const metrics = (row: NonNullable<Activity['campaigns']>['totals']) =>
      `${cell(usd(row.spendMinor), { num: true })}${cell(count(row.reach), { num: true })}${cell(count(row.clicks), { num: true })}${cell(count(row.results), { num: true })}${cell(row.costPerResultMinor === null ? null : usd(row.costPerResultMinor), { num: true })}`;
    parts.push(
      section(
        L.campaigns,
        table(
          [
            { label: L.campaign },
            { label: L.spend, num: true },
            { label: L.reach, num: true },
            { label: L.clicks, num: true },
            { label: L.results, num: true },
            { label: L.costPerResult, num: true },
          ],
          [
            ...sections.campaigns.rows.map(
              (row) =>
                `<tr><td><div class="line-name">${escapeHtml(row.name)}</div><div class="description">${VALUES.adPlatforms[row.platform]} · ${VALUES.adObjectives[row.objective]}</div></td>${metrics(row)}</tr>`,
            ),
            `<tr class="total">${cell(L.total)}${metrics(sections.campaigns.totals)}</tr>`,
          ],
        ),
      ),
    );
  }
  if (sections.adBudget) {
    const budget = sections.adBudget;
    parts.push(
      section(
        L.adBudget,
        `<table class="sums wide">
  <tr><th>${labels.opening}</th><td class="num">${usd(budget.openingMinor)}</td></tr>
  <tr><th>${L.deposits}</th><td class="num">${usd(budget.depositsMinor)}</td></tr>
  <tr><th>${L.refunds}</th><td class="num">${usd(budget.refundsMinor)}</td></tr>
  <tr><th>${L.walletSpend}</th><td class="num">${usd(budget.spendMinor)}</td></tr>
  <tr class="net"><th>${labels.closing}</th><td class="num">${usd(budget.closingMinor)}</td></tr>
</table>`,
      ),
    );
  }
  if (next.posts.length || next.shoots.length) {
    const rows = [
      ...next.posts.map(
        (post) =>
          `<tr>${cell(post.date, { num: true })}${cell(post.title)}${cell(L.plannedPosts)}</tr>`,
      ),
      ...next.shoots.map(
        (shoot) =>
          `<tr>${cell(shoot.date, { num: true })}${cell(shoot.title)}${cell(L.bookedShoots)}</tr>`,
      ),
    ];
    parts.push(
      section(
        labels.next,
        table([{ label: L.date, num: true }, { label: L.work }, { label: '' }], rows),
      ),
    );
  }
  return parts;
}

/** The report's page: its title, the client, the preliminary and empty notes, the sections. */
function reportDocument(
  snapshot: { preliminary: boolean; empty: boolean; companyDetails: string },
  assets: TemplateAssets,
  page: {
    title: string;
    subtitle: string;
    name: string;
    documentTitle: string;
    preliminary: string;
    noActivity: string;
    parts: string[];
  },
): string {
  const preliminary = snapshot.preliminary ? `<p class="badge">${page.preliminary}</p>` : '';
  const empty = snapshot.empty ? `<p class="empty">${page.noActivity}</p>` : '';
  const body = `<div class="title"><h1>${page.title} <span class="version">${escapeHtml(page.subtitle)}</span></h1></div>
<p class="client">${clientLogoTile(assets.clientLogo)}<span>${escapeHtml(page.name)}</span></p>
${preliminary}${empty}
${page.parts.join('\n')}`;
  return documentHtml({
    title: page.documentTitle,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    styles: `
p.client { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; font-size: 12pt;
  font-weight: 500; }
p.badge { display: inline-block; margin: 0 0 12px; padding: 2px 10px; border: 1px solid #B9A87A;
  border-radius: 999px; font-size: 8.5pt; color: #616866; }
p.empty { color: #616866; }
table.lines tr.total td { font-weight: 700; color: #004139; background: #F4F8F7; }
table.sums.wide { width: 60%; margin-inline-start: 0; }
`,
  });
}
