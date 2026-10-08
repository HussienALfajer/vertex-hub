import {
  type ClientMonthlyReport,
  CLIENT_REPORT_LABELS as CR,
  type Currency,
  type OverdueInvoicesReport,
  type ProductivityMeasures,
  type ProductivityReport,
  type RevenueReport,
  REPORT_VALUE_LABELS as VALUES,
  responseTimeText,
} from '@vertex-hub/contracts';
import ExcelJS from 'exceljs';

/*
 * The Excel files of the F15 reports (rule 24): built on request, right-to-left sheets, Arabic
 * headers, dates as dates, money as numbers in major units beside a currency column.
 */

const MINOR_PER_UNIT = 100;

const LABELS = {
  productivity: {
    sheet: 'الإنتاجية',
    department: 'القسم',
    person: 'الشخص',
    archived: 'مؤرشف',
    new: 'جديدة',
    delivered: 'مسلّمة',
    onTime: 'في الموعد (%)',
    clientRevisions: 'تعديلات العميل (متوسط)',
    internalRevisions: 'تعديلات داخلية (متوسط)',
    cycleDays: 'مدة الإنجاز بالأيام (متوسط)',
    openNow: 'مفتوحة الآن',
    overdueNow: 'متأخرة الآن',
    unassigned: 'غير مسندة الآن',
    oldestUnassigned: 'أقدم مهمة غير مسندة',
  },
  revenue: {
    byClient: 'حسب العميل',
    byService: 'حسب الخدمة',
    invoices: 'الفواتير',
    client: 'العميل',
    accountManager: 'مدير الحساب',
    invoiced: 'المفوتر (دولار)',
    collected: 'المحصّل (دولار)',
    outstanding: 'المستحق في نهاية الفترة (دولار)',
    service: 'الخدمة أو الباقة',
    unclassified: 'غير مصنّف',
    archived: 'مؤرشفة',
    number: 'رقم الفاتورة',
    issuedOn: 'تاريخ الإصدار',
    currency: 'العملة',
    total: 'الإجمالي',
    rate: 'سعر الصرف',
    totalUsd: 'الإجمالي (دولار)',
    collectedInPeriod: 'المحصّل في الفترة (دولار)',
  },
  overdue: {
    sheet: 'الفواتير المتأخرة',
    number: 'رقم الفاتورة',
    client: 'العميل',
    accountManager: 'مدير الحساب',
    currency: 'العملة',
    total: 'الإجمالي',
    paid: 'المدفوع',
    balance: 'الرصيد',
    balanceUsd: 'الرصيد (دولار)',
    dueOn: 'تاريخ الاستحقاق',
    days: 'أيام التأخير',
    bucket: 'فئة التأخير',
    totals: 'الإجمالي',
  },
} as const;

type Cell = string | number | Date | null;

interface Column {
  header: string;
  width?: number;
  format?: 'money' | 'date' | 'decimal' | 'count';
}

const money = (minor: number | null) => (minor === null ? null : minor / MINOR_PER_UNIT);

/** A calendar date as an Excel date (midnight UTC, so the day never shifts). */
const day = (date: string | null) => (date ? new Date(`${date}T00:00:00Z`) : null);

const FORMATS = {
  money: '#,##0.00',
  date: 'yyyy-mm-dd',
  decimal: '0.0',
  count: '#,##0',
} as const;

function addSheet(workbook: ExcelJS.Workbook, name: string, columns: Column[], rows: Cell[][]) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width ?? 16,
    style: column.format ? { numFmt: FORMATS[column.format] } : {},
  }));
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

async function toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function newWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Vertex Hub';
  return workbook;
}

const measureColumns: Column[] = [
  { header: LABELS.productivity.new, width: 10 },
  { header: LABELS.productivity.delivered, width: 10 },
  { header: LABELS.productivity.onTime, width: 14 },
  { header: LABELS.productivity.clientRevisions, width: 20, format: 'decimal' },
  { header: LABELS.productivity.internalRevisions, width: 22, format: 'decimal' },
  { header: LABELS.productivity.cycleDays, width: 22, format: 'decimal' },
  { header: LABELS.productivity.openNow, width: 12 },
  { header: LABELS.productivity.overdueNow, width: 12 },
];

const measureCells = (measures: ProductivityMeasures): Cell[] => [
  measures.new,
  measures.delivered,
  measures.onTimeRate,
  measures.averageClientRevisions,
  measures.averageInternalRevisions,
  measures.averageCycleDays,
  measures.openNow,
  measures.overdueNow,
];

/** Rules 8–10: one sheet, a department row followed by its people. */
export async function productivityWorkbook(report: ProductivityReport): Promise<Buffer> {
  const workbook = newWorkbook();
  const rows: Cell[][] = report.departments.flatMap((department) => [
    [
      department.name,
      null,
      ...measureCells(department.measures),
      department.unassigned.count,
      day(department.unassigned.oldestOn),
    ],
    ...department.people.map((person): Cell[] => [
      department.name,
      person.user.archived
        ? `${person.user.name} (${LABELS.productivity.archived})`
        : person.user.name,
      ...measureCells(person.measures),
      null,
      null,
    ]),
  ]);
  addSheet(
    workbook,
    LABELS.productivity.sheet,
    [
      { header: LABELS.productivity.department, width: 22 },
      { header: LABELS.productivity.person, width: 22 },
      ...measureColumns,
      { header: LABELS.productivity.unassigned, width: 14 },
      { header: LABELS.productivity.oldestUnassigned, width: 18, format: 'date' },
    ],
    rows,
  );
  return toBuffer(workbook);
}

/** Rule 15: By client, By service and Invoices sheets, USD in major units. */
export async function revenueWorkbook(report: RevenueReport): Promise<Buffer> {
  const workbook = newWorkbook();
  const L = LABELS.revenue;
  addSheet(
    workbook,
    L.byClient,
    [
      { header: L.client, width: 28 },
      { header: L.accountManager, width: 22 },
      { header: L.invoiced, format: 'money' },
      { header: L.collected, format: 'money' },
      { header: L.outstanding, width: 26, format: 'money' },
    ],
    report.byClient.map((row) => [
      row.client.name,
      row.accountManager?.name ?? null,
      money(row.invoicedUsdMinor),
      money(row.collectedUsdMinor),
      money(row.outstandingUsdMinor),
    ]),
  );
  addSheet(
    workbook,
    L.byService,
    [
      { header: L.service, width: 32 },
      { header: L.invoiced, format: 'money' },
      { header: L.collected, format: 'money' },
    ],
    report.byService.map((row) => [
      row.kind === 'unclassified'
        ? L.unclassified
        : row.archived
          ? `${row.name ?? ''} (${L.archived})`
          : row.name,
      money(row.invoicedUsdMinor),
      money(row.collectedUsdMinor),
    ]),
  );
  addSheet(
    workbook,
    L.invoices,
    [
      { header: L.number, width: 16 },
      { header: L.client, width: 28 },
      { header: L.issuedOn, format: 'date' },
      { header: L.currency, width: 8 },
      { header: L.total, format: 'money' },
      { header: L.rate, width: 12 },
      { header: L.totalUsd, format: 'money' },
      { header: L.collectedInPeriod, width: 22, format: 'money' },
    ],
    report.invoices.map((invoice) => [
      invoice.number,
      invoice.client.name,
      day(invoice.issuedOn),
      invoice.currency,
      money(invoice.totalMinor),
      invoice.sypPerUsd === null ? null : Number(invoice.sypPerUsd),
      money(invoice.totalUsdMinor),
      money(invoice.collectedUsdMinor),
    ]),
  );
  return toBuffer(workbook);
}

/** Rule 16: the overdue invoices with totals per currency and in USD. */
export async function overdueWorkbook(report: OverdueInvoicesReport): Promise<Buffer> {
  const workbook = newWorkbook();
  const L = LABELS.overdue;
  const rows: Cell[][] = report.invoices.map((invoice) => [
    invoice.number,
    invoice.client.name,
    invoice.accountManager?.name ?? null,
    invoice.currency,
    money(invoice.totalMinor),
    money(invoice.paidMinor),
    money(invoice.balanceMinor),
    money(invoice.balanceUsdMinor),
    day(invoice.dueOn),
    invoice.daysOverdue,
    VALUES.agingBuckets[invoice.bucket],
  ]);
  const totalRow = (currency: Currency | 'USD', balance: number | null, usd: number | null) => [
    L.totals,
    null,
    null,
    currency,
    null,
    null,
    money(balance),
    money(usd),
    null,
    null,
    null,
  ];
  rows.push([]);
  for (const total of report.totals.byCurrency) {
    rows.push(totalRow(total.currency, total.amountMinor, null));
  }
  rows.push(totalRow('USD', null, report.totals.usdMinor));
  addSheet(
    workbook,
    L.sheet,
    [
      { header: L.number, width: 16 },
      { header: L.client, width: 28 },
      { header: L.accountManager, width: 22 },
      { header: L.currency, width: 8 },
      { header: L.total, format: 'money' },
      { header: L.paid, format: 'money' },
      { header: L.balance, format: 'money' },
      { header: L.balanceUsd, format: 'money' },
      { header: L.dueOn, format: 'date' },
      { header: L.days, width: 12 },
      { header: L.bucket, width: 18 },
    ],
    rows,
  );
  return toBuffer(workbook);
}

/** Rules 17–18: one sheet per section with data, the summary first. */
export async function clientReportWorkbook(report: ClientMonthlyReport): Promise<Buffer> {
  const workbook = newWorkbook();
  const heading = [
    [`${CR.title} — ${report.client.name}`, report.month],
    ...(report.preliminary ? [[CR.preliminary]] : []),
    ...(report.empty ? [[CR.noActivity]] : []),
    ...(report.summary ? [[], [CR.summary], [report.summary.text]] : []),
  ];
  const first = workbook.addWorksheet(CR.summary, { views: [{ rightToLeft: true }] });
  first.getColumn(1).width = 80;
  for (const row of heading) first.addRow(row);
  first.getRow(1).font = { bold: true };
  first.getColumn(1).alignment = { wrapText: true, vertical: 'top' };

  if (report.retainers.length) {
    addSheet(
      workbook,
      CR.retainers,
      [
        { header: CR.retainers, width: 26 },
        { header: CR.kind, width: 22 },
        { header: CR.committed, width: 12 },
        { header: CR.delivered, width: 12 },
        { header: CR.percent, width: 10 },
      ],
      report.retainers.flatMap((retainer) => [
        ...retainer.lines.map((line): Cell[] => [
          retainer.retainer.name,
          line.label ?? VALUES.deliverableKinds[line.kind],
          line.committed,
          line.delivered,
          line.percent,
        ]),
        [retainer.retainer.name, CR.completion, null, null, retainer.completion],
      ]),
    );
  }
  if (report.projects.length) {
    addSheet(
      workbook,
      CR.projects,
      [
        { header: CR.project, width: 28 },
        { header: CR.status, width: 12 },
        { header: CR.progress, width: 16 },
        { header: CR.milestonesDone, width: 40 },
      ],
      report.projects.map((project) => [
        project.project.name,
        VALUES.projectStatuses[project.status],
        project.totalTasks === 0 ? null : `${project.deliveredTasks} / ${project.totalTasks}`,
        project.milestonesDone.map((milestone) => milestone.name).join('، '),
      ]),
    );
  }
  if (report.deliveredWork.length) {
    addSheet(
      workbook,
      CR.deliveredWork,
      [
        { header: CR.date, format: 'date' },
        { header: CR.work, width: 40 },
        { header: CR.department, width: 22 },
      ],
      report.deliveredWork.map((work) => [day(work.deliveredOn), work.title, work.departmentName]),
    );
  }
  if (report.posts.length) {
    addSheet(
      workbook,
      CR.posts,
      [
        { header: CR.date, format: 'date' },
        { header: CR.postTitle, width: 36 },
        { header: CR.platforms, width: 26 },
        { header: CR.links, width: 50 },
      ],
      report.posts.map((post) => [
        day(post.publishedOn),
        post.title,
        post.platforms.map((platform) => VALUES.postPlatforms[platform]).join('، '),
        post.links.map((link) => link.url).join('\n'),
      ]),
    );
  }
  if (report.shoots.length) {
    addSheet(
      workbook,
      CR.shoots,
      [
        { header: CR.date, format: 'date' },
        { header: CR.shoot, width: 32 },
        { header: CR.location, width: 32 },
      ],
      report.shoots.map((shoot) => [day(shoot.date), shoot.title, shoot.location]),
    );
  }
  const approvals = report.approvals;
  if (approvals.approved + approvals.changesRequested > 0) {
    addSheet(
      workbook,
      CR.approvals,
      [
        { header: CR.approvals, width: 24 },
        { header: '', width: 16 },
      ],
      [
        [CR.approved, approvals.approved],
        [CR.changesRequested, approvals.changesRequested],
        [
          CR.averageResponse,
          approvals.averageResponseHours === null
            ? null
            : responseTimeText(approvals.averageResponseHours),
        ],
      ],
    );
  }
  if (report.campaigns?.rows.length) {
    const metrics = (row: NonNullable<ClientMonthlyReport['campaigns']>['totals']): Cell[] => [
      money(row.spendMinor),
      row.reach,
      row.clicks,
      row.results,
      money(row.costPerResultMinor),
    ];
    addSheet(
      workbook,
      CR.campaigns,
      [
        { header: CR.platform, width: 14 },
        { header: CR.campaign, width: 28 },
        { header: CR.objective, width: 18 },
        { header: CR.spend, format: 'money' },
        { header: CR.reach, width: 12, format: 'count' },
        { header: CR.clicks, width: 12, format: 'count' },
        { header: CR.results, width: 12, format: 'count' },
        { header: CR.costPerResult, width: 20, format: 'money' },
      ],
      [
        ...report.campaigns.rows.map((row): Cell[] => [
          VALUES.adPlatforms[row.platform],
          row.name,
          VALUES.adObjectives[row.objective],
          ...metrics(row),
        ]),
        [CR.total, null, null, ...metrics(report.campaigns.totals)],
      ],
    );
  }
  if (report.adBudget) {
    const budget = report.adBudget;
    addSheet(
      workbook,
      CR.adBudget,
      [
        { header: CR.adBudget, width: 26 },
        { header: '', format: 'money' },
      ],
      [
        [CR.opening, money(budget.openingMinor)],
        [CR.deposits, money(budget.depositsMinor)],
        [CR.refunds, money(budget.refundsMinor)],
        [CR.walletSpend, money(budget.spendMinor)],
        [CR.closing, money(budget.closingMinor)],
      ],
    );
  }
  const next = report.nextMonth;
  if (next.posts.length || next.shoots.length) {
    addSheet(
      workbook,
      CR.nextMonth,
      [
        { header: CR.date, format: 'date' },
        { header: CR.nextMonth, width: 40 },
        { header: '', width: 22 },
      ],
      [
        ...next.posts.map((post): Cell[] => [day(post.date), post.title, CR.plannedPosts]),
        ...next.shoots.map((shoot): Cell[] => [day(shoot.date), shoot.title, CR.bookedShoots]),
      ],
    );
  }
  return toBuffer(workbook);
}
