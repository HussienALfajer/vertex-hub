import {
  type ClientReportSnapshot,
  CLIENT_REPORT_LABELS as L,
  responseTimeText,
  REPORT_VALUE_LABELS as VALUES,
} from '@vertex-hub/contracts';
import {
  documentHtml,
  escapeHtml,
  formatMoney,
  type TemplateAssets,
  textBlock,
} from './document.js';

/*
 * The monthly client report (spec F15 rules 18 and 20), in the shell of `document.ts`. It prints
 * its payload only: each section with data, in the order of rule 18.
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
        `${L.retainers}: ${escapeHtml(retainer.retainer.name)}`,
        table(
          [
            { label: L.kind },
            { label: L.committed, num: true },
            { label: L.delivered, num: true },
            { label: L.percent, num: true },
          ],
          [
            ...retainer.lines.map(
              (line) =>
                `<tr>${cell(line.label ?? VALUES.deliverableKinds[line.kind])}${cell(count(line.committed), { num: true })}${cell(count(line.delivered), { num: true })}${cell(line.percent === null ? null : `${line.percent}%`, { num: true })}</tr>`,
            ),
            `<tr class="total">${cell(L.completion)}<td></td><td></td>${cell(retainer.completion === null ? null : `${retainer.completion}%`, { num: true })}</tr>`,
          ],
        ),
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
  if (snapshot.deliveredWork.length) {
    parts.push(
      section(
        L.deliveredWork,
        table(
          [{ label: L.date, num: true }, { label: L.work }, { label: L.department }],
          snapshot.deliveredWork.map(
            (work) =>
              `<tr>${cell(work.deliveredOn, { num: true })}${cell(work.title)}${cell(work.departmentName)}</tr>`,
          ),
        ),
      ),
    );
  }
  if (snapshot.posts.length) {
    parts.push(
      section(
        L.posts,
        table(
          [{ label: L.date, num: true }, { label: L.postTitle }, { label: L.platforms }],
          snapshot.posts.map((post) => {
            const links = post.links
              .map((link) => `<div class="description num">${escapeHtml(link.url)}</div>`)
              .join('');
            return `<tr>${cell(post.publishedOn, { num: true })}<td>${escapeHtml(post.title)}${links}</td>${cell(post.platforms.map((p) => VALUES.postPlatforms[p]).join('، '))}</tr>`;
          }),
        ),
      ),
    );
  }
  if (snapshot.shoots.length) {
    parts.push(
      section(
        L.shoots,
        table(
          [{ label: L.date, num: true }, { label: L.shoot }, { label: L.location }],
          snapshot.shoots.map(
            (shoot) =>
              `<tr>${cell(shoot.date, { num: true })}${cell(shoot.title)}${cell(shoot.location)}</tr>`,
          ),
        ),
      ),
    );
  }
  const approvals = snapshot.approvals;
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
  if (snapshot.campaigns?.rows.length) {
    const metrics = (row: NonNullable<ClientReportSnapshot['campaigns']>['totals']) =>
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
            ...snapshot.campaigns.rows.map(
              (row) =>
                `<tr><td><div class="line-name">${escapeHtml(row.name)}</div><div class="description">${VALUES.adPlatforms[row.platform]} · ${VALUES.adObjectives[row.objective]}</div></td>${metrics(row)}</tr>`,
            ),
            `<tr class="total">${cell(L.total)}${metrics(snapshot.campaigns.totals)}</tr>`,
          ],
        ),
      ),
    );
  }
  if (snapshot.adBudget) {
    const budget = snapshot.adBudget;
    parts.push(
      section(
        L.adBudget,
        `<table class="sums wide">
  <tr><th>${L.opening}</th><td class="num">${usd(budget.openingMinor)}</td></tr>
  <tr><th>${L.deposits}</th><td class="num">${usd(budget.depositsMinor)}</td></tr>
  <tr><th>${L.refunds}</th><td class="num">${usd(budget.refundsMinor)}</td></tr>
  <tr><th>${L.walletSpend}</th><td class="num">${usd(budget.spendMinor)}</td></tr>
  <tr class="net"><th>${L.closing}</th><td class="num">${usd(budget.closingMinor)}</td></tr>
</table>`,
      ),
    );
  }
  const next = snapshot.nextMonth;
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
        L.nextMonth,
        table([{ label: L.date, num: true }, { label: L.work }, { label: '' }], rows),
      ),
    );
  }
  const preliminary = snapshot.preliminary ? `<p class="badge">${L.preliminary}</p>` : '';
  const empty = snapshot.empty ? `<p class="empty">${L.noActivity}</p>` : '';
  const body = `<div class="title"><h1>${L.title} <span class="version">${escapeHtml(month)}</span></h1></div>
<p class="client">${escapeHtml(snapshot.client.name)}</p>
${preliminary}${empty}
${parts.join('\n')}`;
  return documentHtml({
    title: `${L.title} ${snapshot.client.name} ${snapshot.month}`,
    companyDetails: snapshot.companyDetails,
    body,
    assets,
    styles: `
p.client { margin: 0 0 12px; font-size: 12pt; font-weight: 500; }
p.badge { display: inline-block; margin: 0 0 12px; padding: 2px 10px; border: 1px solid #B9A87A;
  border-radius: 999px; font-size: 8.5pt; color: #616866; }
p.empty { color: #616866; }
table.lines tr.total td { font-weight: 700; color: #004139; background: #F4F8F7; }
table.sums.wide { width: 60%; margin-inline-start: 0; }
`,
  });
}
