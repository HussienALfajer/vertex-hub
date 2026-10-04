import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  businessDate,
  type CompanyDashboard,
  conversionRate,
  DEPARTMENT_CODES,
  type DepartmentCode,
  type DepartmentDashboard,
  type FinanceDashboard,
  isApprovalWaiting,
  type MyClientsDashboard,
  type Permission,
  permissionScopes,
  reportMonths,
  weekOf,
} from '@vertex-hub/contracts';
import { ApprovalReports } from '../approvals/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { CampaignReports } from '../campaigns/index.js';
import { ClientDirectory } from '../clients/index.js';
import { InvoiceReports } from '../invoices/index.js';
import { LeadReports } from '../leads/index.js';
import { EngagementReports } from '../projects/index.js';
import { TaskReports } from '../tasks/index.js';

/** The caller holds `permission` over clients they manage (`all` covers them too). */
const coversOwnClients = (actor: CurrentUserInfo, permission: Permission) =>
  permissionScopes(actor.access, permission).some(
    (scope) => scope === 'all' || scope === 'own_clients',
  );

/**
 * The home page sections (spec F15, rules 1–7, 23): computed on read through the report services
 * other modules export (ADR 0027). Each section checks its own `reports.*` scope.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly clients: ClientDirectory,
    private readonly tasks: TaskReports,
    private readonly engagements: EngagementReports,
    private readonly invoices: InvoiceReports,
    private readonly leads: LeadReports,
    private readonly campaigns: CampaignReports,
    private readonly approvals: ApprovalReports,
  ) {}

  /** Rule 1: `reports.read` under `all`. */
  async company(actor: CurrentUserInfo): Promise<CompanyDashboard> {
    if (!permissionScopes(actor.access, 'reports.read').includes('all')) {
      throw new ForbiddenException();
    }
    const now = new Date();
    const today = businessDate(now);
    const months = reportMonths(today);
    const [active, departments, progress, waiting, lowWallets, thisMonth, lastMonth] =
      await Promise.all([
        this.engagements.activeCounts(),
        this.tasks.departmentCounts(DEPARTMENT_CODES, now),
        this.engagements.retainerProgress('all', today),
        this.approvals.waiting(now),
        this.campaigns.lowWallets('all'),
        this.leads.counts(months.thisMonth),
        this.leads.counts(months.lastMonth),
      ]);
    const behind = progress.filter((row) => row.linesBehind > 0);
    const names = await this.clients.summaries([
      ...behind.map((row) => row.clientId),
      ...lowWallets.map((row) => row.clientId),
      ...(waiting.oldest ? [waiting.oldest.clientId] : []),
    ]);
    const client = (id: string) => ({ id, name: names.get(id)?.name ?? '' });
    const byName = (a: { client: { name: string } }, b: { client: { name: string } }) =>
      a.client.name.localeCompare(b.client.name, 'ar');
    const leadMonth = (counts: { new: number; won: number; lost: number }) => ({
      ...counts,
      conversionRate: conversionRate(counts.won, counts.lost),
    });
    return {
      months,
      activeEngagements: active,
      departments: [...departments].map(([department, counts]) => ({ department, ...counts })),
      retainersBehind: behind
        .map((row) => ({
          client: client(row.clientId),
          retainer: row.retainer,
          cycleId: row.cycleId,
          linesBehind: row.linesBehind,
          completion: row.completion,
        }))
        .sort(byName),
      approvalsWaiting: {
        count: waiting.count,
        oldest: waiting.oldest
          ? {
              itemId: waiting.oldest.itemId,
              title: waiting.oldest.title,
              client: client(waiting.oldest.clientId),
              sentAt: waiting.oldest.sentAt.toISOString(),
              expired: waiting.oldest.expired,
            }
          : null,
      },
      lowWallets: lowWallets
        .map((row) => ({ client: client(row.clientId), balanceUsdMinor: row.balanceUsdMinor }))
        .sort(byName),
      leads: { thisMonth: leadMonth(thisMonth), lastMonth: leadMonth(lastMonth) },
    };
  }

  /** Rule 2: `reports.finance` (checked by the route). */
  async finance(): Promise<FinanceDashboard> {
    const months = reportMonths(businessDate());
    const [invoicedNow, invoicedBefore, collectedNow, collectedBefore, open] = await Promise.all([
      this.invoices.invoicedUsd(months.thisMonth),
      this.invoices.invoicedUsd(months.lastMonth),
      this.invoices.collectedUsd(months.thisMonth),
      this.invoices.collectedUsd(months.lastMonth),
      this.invoices.outstanding('all'),
    ]);
    return {
      months,
      invoicedUsdMinor: { thisMonth: invoicedNow, lastMonth: invoicedBefore },
      collectedUsdMinor: { thisMonth: collectedNow, lastMonth: collectedBefore },
      outstanding: open.outstanding,
      overdue: open.overdue,
    };
  }

  /**
   * Rule 3: `reports.read` under `department` (the departments the caller manages) or `all` (any
   * department). The default is the first department the caller manages, else the first in scope.
   */
  async department(
    actor: CurrentUserInfo,
    requested: DepartmentCode | undefined,
  ): Promise<DepartmentDashboard> {
    const scopes = permissionScopes(actor.access, 'reports.read');
    const managed = actor.access.departments.filter((d) => d.isManager).map((d) => d.code);
    const departments = DEPARTMENT_CODES.filter(
      (code) => scopes.includes('all') || (scopes.includes('department') && managed.includes(code)),
    );
    const department =
      requested ?? departments.find((code) => managed.includes(code)) ?? departments[0];
    if (!department || !departments.includes(department)) throw new ForbiddenException();
    const now = new Date();
    return {
      departments,
      department,
      week: weekOf(businessDate(now)),
      ...(await this.tasks.department(department, now)),
    };
  }

  /** Rule 4: `reports.read` under `own_clients`; money and wallets need their own read scope. */
  async myClients(actor: CurrentUserInfo): Promise<MyClientsDashboard> {
    if (!permissionScopes(actor.access, 'reports.read').includes('own_clients')) {
      throw new ForbiddenException();
    }
    const now = new Date();
    const today = businessDate(now);
    const clients = await this.clients.managed(actor.id);
    const ids = clients.map((client) => client.id);
    const readsInvoices = coversOwnClients(actor, 'invoices.read');
    const readsCampaigns = coversOwnClients(actor, 'campaigns.read');
    const [progress, projects, approvals, invoices, lowWallets] = await Promise.all([
      this.engagements.retainerProgress(ids, today),
      this.engagements.openProjects(ids),
      this.approvals.pendingByClient(ids),
      readsInvoices ? this.invoices.outstanding(ids) : null,
      readsCampaigns ? this.campaigns.lowWallets(ids) : null,
    ]);
    const low = new Set(lowWallets?.map((row) => row.clientId));
    const rows = clients.map((client) => {
      const retainers = progress
        .filter((row) => row.clientId === client.id)
        .map((row) => ({
          retainer: row.retainer,
          completion: row.completion,
          behind: row.linesBehind > 0,
        }));
      const pending = approvals.get(client.id);
      const waiting = pending ? isApprovalWaiting(pending.oldestSentAt, now) : false;
      const money = invoices
        ? (invoices.byClient.get(client.id) ?? { outstandingUsdMinor: 0, overdue: 0 })
        : null;
      const lowWallet = lowWallets ? low.has(client.id) : null;
      return {
        client: { id: client.id, name: client.name },
        retainers,
        openProjects: projects.get(client.id) ?? 0,
        approvals: {
          pending: pending?.pending ?? 0,
          oldestSentAt: pending?.oldestSentAt.toISOString() ?? null,
          waiting,
        },
        invoices: money,
        lowWallet,
        hasProblem:
          retainers.some((row) => row.behind) ||
          (money?.overdue ?? 0) > 0 ||
          !!lowWallet ||
          waiting,
      };
    });
    // Clients come by name; the stable sort keeps that order within each group.
    return { clients: rows.sort((a, b) => Number(b.hasProblem) - Number(a.hasProblem)) };
  }
}
