import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  agingBucket,
  businessDate,
  CURRENCIES,
  type Currency,
  daysOverdue,
  isValidReportPeriod,
  type OverdueInvoicesQuery,
  type OverdueInvoicesReport,
  type ProductivityQuery,
  type ProductivityReport,
  type ReportPeriod,
  type RevenueReport,
  reportMonths,
} from '@vertex-hub/contracts';
import { CodedException } from '../../core/errors/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { CatalogDirectory } from '../catalog/index.js';
import { ClientDirectory } from '../clients/index.js';
import { InvoiceReports } from '../invoices/index.js';
import { TaskReports } from '../tasks/index.js';
import { reportDepartments } from './report-access.js';

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name, 'ar');

/**
 * The department productivity, revenue and overdue invoices reports (spec F15, rules 8–16, 23),
 * computed on read through the report services of `tasks` and `invoices` (ADR 0027).
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly tasks: TaskReports,
    private readonly invoices: InvoiceReports,
    private readonly clients: ClientDirectory,
    private readonly users: UserDirectory,
    private readonly catalog: CatalogDirectory,
  ) {}

  /**
   * Rules 8–10: `reports.read` under `department` (the departments the caller manages) or `all`;
   * a department outside the scope is a 403.
   */
  async productivity(
    actor: CurrentUserInfo,
    query: ProductivityQuery,
  ): Promise<ProductivityReport> {
    const inScope = reportDepartments(actor);
    const departments = query.department
      ? inScope.filter((code) => query.department?.includes(code))
      : inScope;
    if (departments.length === 0 || query.department?.some((code) => !inScope.includes(code))) {
      throw new ForbiddenException();
    }
    const period = reportPeriod(query);
    const [figures, members, names] = await Promise.all([
      this.tasks.productivity(departments, period),
      this.users.activeMembers(departments),
      this.users.departmentNames(),
    ]);
    const others = [...figures.people.values()].flatMap((people) => [...people.keys()]);
    const known = await this.users.summaries([...members.map((member) => member.id), ...others]);
    return {
      period,
      departments: departments.map((code) => {
        const department = figures.departments.get(code);
        const people = figures.people.get(code) ?? new Map();
        const memberIds = members
          .filter((member) => member.departments.includes(code))
          .map((member) => member.id);
        // Rule 9: members, then anyone who delivered a task of the department in the period.
        const deliverers = [...people]
          .filter(([id, measures]) => !memberIds.includes(id) && measures.delivered > 0)
          .map(([id]) => id);
        const listed = [...memberIds, ...deliverers].flatMap((id) => {
          const user = known.get(id);
          return user ? [user] : [];
        });
        return {
          department: code,
          name: names.get(code) ?? code,
          measures: department?.measures ?? emptyMeasures(),
          unassigned: department?.unassigned ?? { count: 0, oldestOn: null },
          people: listed.sort(byName).map((user) => ({
            user: { id: user.id, name: user.name, archived: user.archived },
            measures: people.get(user.id) ?? emptyMeasures(),
          })),
        };
      }),
    };
  }

  /** Rules 11–15: `reports.finance` (checked by the route). */
  async revenue(query: { from?: string; to?: string }): Promise<RevenueReport> {
    const period = reportPeriod(query);
    const figures = await this.invoices.revenue(period);
    const clientIds = [
      ...figures.byClient.keys(),
      ...figures.invoices.map((invoice) => invoice.clientId),
    ];
    const clients = await this.clients.summaries(clientIds);
    const managers = await this.users.summaries(
      [...clients.values()].map((client) => client.accountManagerId),
    );
    const named = (id: string) => ({ id, name: clients.get(id)?.name ?? '' });
    const keys = [...figures.byTarget.keys()];
    const idsOf = (prefix: string) =>
      keys.flatMap((key) => (key?.startsWith(prefix) ? [key.slice(prefix.length)] : []));
    const [services, packages] = await Promise.all([
      this.catalog.services(idsOf('service:')),
      this.catalog.packages(idsOf('package:')),
    ]);
    const byService = [...figures.byTarget].map(([key, amounts]) => {
      const [kind, id] = key ? (key.split(':') as ['service' | 'package', string]) : [null, null];
      const item = kind === 'service' ? services.get(id ?? '') : packages.get(id ?? '');
      return {
        kind: kind ?? ('unclassified' as const),
        id: kind ? (id ?? null) : null,
        name: item?.name ?? null,
        archived: item?.archived ?? false,
        ...amounts,
      };
    });
    return {
      period,
      invoicedUsdMinor: figures.invoicedUsdMinor,
      collectedUsdMinor: figures.collectedUsdMinor,
      byClient: [...figures.byClient]
        .filter(
          ([, row]) => row.invoicedUsdMinor || row.collectedUsdMinor || row.outstandingUsdMinor,
        )
        .map(([id, row]) => {
          const manager = managers.get(clients.get(id)?.accountManagerId ?? '');
          return {
            client: named(id),
            accountManager: manager ? { id: manager.id, name: manager.name } : null,
            ...row,
          };
        })
        .sort((a, b) => byName(a.client, b.client)),
      // "Unclassified" last, the others by invoiced amount, largest first.
      byService: byService.sort(
        (a, b) =>
          Number(a.kind === 'unclassified') - Number(b.kind === 'unclassified') ||
          b.invoicedUsdMinor - a.invoicedUsdMinor ||
          (a.name ?? '').localeCompare(b.name ?? '', 'ar'),
      ),
      invoices: figures.invoices.map(({ clientId, ...invoice }) => ({
        ...invoice,
        client: named(clientId),
      })),
    };
  }

  /** Rule 16: `reports.finance` (checked by the route). */
  async overdueInvoices(query: OverdueInvoicesQuery): Promise<OverdueInvoicesReport> {
    const today = businessDate();
    const rows = await this.invoices.overdueInvoices('all', query.currency);
    const clients = await this.clients.summaries(rows.map((row) => row.clientId));
    const managers = await this.users.summaries(
      [...clients.values()].map((client) => client.accountManagerId),
    );
    const invoices = rows
      .filter(
        (row) =>
          !query.accountManagerId ||
          clients.get(row.clientId)?.accountManagerId === query.accountManagerId,
      )
      .map(({ clientId, ...row }) => {
        const client = clients.get(clientId);
        const manager = managers.get(client?.accountManagerId ?? '');
        const days = daysOverdue(row.dueOn, today);
        return {
          ...row,
          client: { id: clientId, name: client?.name ?? '' },
          accountManager: manager ? { id: manager.id, name: manager.name } : null,
          daysOverdue: days,
          bucket: agingBucket(days),
        };
      })
      .sort((a, b) => b.daysOverdue - a.daysOverdue || a.number.localeCompare(b.number));
    const byCurrency = new Map<Currency, number>();
    for (const invoice of invoices) {
      byCurrency.set(
        invoice.currency,
        (byCurrency.get(invoice.currency) ?? 0) + invoice.balanceMinor,
      );
    }
    return {
      today,
      invoices,
      totals: {
        count: invoices.length,
        byCurrency: CURRENCIES.flatMap((currency) => {
          const amountMinor = byCurrency.get(currency);
          return amountMinor === undefined ? [] : [{ currency, amountMinor }];
        }),
        usdMinor: invoices.reduce((sum, invoice) => sum + invoice.balanceUsdMinor, 0),
      },
    };
  }
}

/** Rules 8 and 11: this month up to today by default; `INVALID_DATES` past 366 days. */
export function reportPeriod(query: { from?: string; to?: string }): ReportPeriod {
  const thisMonth = reportMonths(businessDate()).thisMonth;
  const period = { from: query.from ?? thisMonth.from, to: query.to ?? thisMonth.to };
  if (!isValidReportPeriod(period)) {
    throw new CodedException(
      400,
      'INVALID_DATES',
      'The period must end on or after its start and span at most 366 days',
    );
  }
  return period;
}

const emptyMeasures = () => ({
  new: 0,
  delivered: 0,
  onTimeRate: null,
  averageClientRevisions: null,
  averageInternalRevisions: null,
  averageCycleDays: null,
  openNow: 0,
  overdueNow: 0,
});
