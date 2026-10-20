import { Injectable } from '@nestjs/common';
import type { ProjectStatus, RetainerStatus } from '@vertex-hub/contracts';
import { type Database, projects, retainers, type Transaction } from '@vertex-hub/db';
import { eq } from 'drizzle-orm';
import { UserDirectory, type UserSummary } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import { type Notice, NotificationCenter, type Resolution } from '../notifications/index.js';

/** A project as its notices name it. */
export interface NoticeProject {
  id: string;
  name: string;
  projectManagerId: string;
  client: Pick<ClientSummary, 'name' | 'accountManagerId'>;
}

/** The engagement extra work is logged on. */
export type ExtraWorkEngagement = { kind: 'project' | 'retainer'; id: string };

/** What closes a retainer's renewal reminder (F05 R6). */
const renewalClosed = (
  retainerId: string,
  outcome: Resolution['outcome'],
  actorId: string | null,
): Resolution => ({
  subject: { type: 'retainer', id: retainerId },
  types: ['retainer_renewal_due'],
  outcome,
  actorId,
});

/**
 * F16 part C: the notices of projects and retainers (status, milestones, extra work, contracts,
 * a new project manager) and what their changes close. Recipients by role come from
 * `UserDirectory`; client names and account managers from `ClientDirectory`.
 */
@Injectable()
export class EngagementNotices {
  constructor(
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly center: NotificationCenter,
  ) {}

  /**
   * F14: the new project manager learns about the project; part C rule 4: the previous one
   * learns who manages it now.
   */
  managerAssigned(
    tx: Transaction,
    project: NoticeProject,
    manager: UserSummary,
    actorId: string,
    previousId: string | null = null,
  ): Promise<number> {
    return this.center.notify(tx, [
      {
        type: 'project_manager_assigned',
        recipients: [manager.id],
        actorId,
        subjectId: project.id,
        data: { project: project.name, client: project.client.name },
      },
      {
        type: 'responsibility_moved',
        recipients: previousId ? [previousId] : [],
        actorId,
        subjectId: project.id,
        subjectType: 'project',
        data: { role: 'project_manager', record: project.name, holder: manager.name },
      },
    ]);
  }

  /**
   * The account manager, the project manager and the managers of the project's departments;
   * Finance too when it completes or is cancelled.
   */
  async projectStatus(
    tx: Transaction,
    project: NoticeProject,
    status: ProjectStatus,
    actorId: string,
  ): Promise<void> {
    const [row] = await tx
      .select({ departments: projects.departments })
      .from(projects)
      .where(eq(projects.id, project.id));
    const managers = await this.users.departmentManagers(row?.departments ?? [], tx);
    const finance =
      status === 'completed' || status === 'cancelled'
        ? await this.users.withRole('finance', tx)
        : [];
    await this.center.notify(tx, {
      type: 'project_status_changed',
      recipients: [
        project.client.accountManagerId,
        project.projectManagerId,
        ...[...managers.values()].flat(),
        ...finance,
      ],
      actorId,
      subjectId: project.id,
      data: { project: project.name, client: project.client.name, status },
    });
  }

  /** The account manager and the project manager. */
  async milestoneCompleted(
    tx: Transaction,
    project: NoticeProject,
    milestone: string,
    actorId: string,
  ): Promise<void> {
    await this.center.notify(tx, {
      type: 'milestone_completed',
      recipients: [project.client.accountManagerId, project.projectManagerId],
      actorId,
      subjectId: project.id,
      data: { project: project.name, client: project.client.name, milestone },
    });
  }

  /** Finance and the account manager, by hand or from a revision decision. */
  async extraWorkCreated(
    tx: Transaction,
    engagement: ExtraWorkEngagement,
    title: string,
    actorId: string | null,
  ): Promise<void> {
    const table = engagement.kind === 'project' ? projects : retainers;
    const [row] = await tx
      .select({ name: table.name, clientId: table.clientId })
      .from(table)
      .where(eq(table.id, engagement.id));
    const client = row && (await this.clients.summary(row.clientId, tx));
    if (!row || !client) return;
    await this.center.notify(tx, {
      type: 'extra_work_created',
      recipients: [client.accountManagerId, ...(await this.users.withRole('finance', tx))],
      actorId,
      subjectId: engagement.id,
      subjectType: engagement.kind,
      data: { title, engagement: row.name, client: client.name },
    });
  }

  /**
   * Paused, ended (by hand or by its term) or active again: the account manager, Finance and the
   * managers of its departments. Ending it voids its renewal reminder.
   */
  async retainerStatus(
    tx: Transaction,
    retainerId: string,
    status: RetainerStatus,
    actorId: string | null,
  ): Promise<void> {
    const retainer = await this.retainer(tx, retainerId);
    if (!retainer) return;
    const [managers, finance] = await Promise.all([
      this.users.departmentManagers(retainer.departments, tx),
      this.users.withRole('finance', tx),
    ]);
    await this.center.notify(
      tx,
      {
        type: 'retainer_status_changed',
        recipients: [
          retainer.client.accountManagerId,
          ...finance,
          ...[...managers.values()].flat(),
        ],
        actorId,
        subjectId: retainerId,
        data: { retainer: retainer.name, client: retainer.client.name, status },
      },
      status === 'ended' ? [renewalClosed(retainerId, 'void', actorId)] : [],
    );
  }

  /** The renewal date moved (a term was added or cancelled): the reminder is done. */
  renewalMoved(tx: Transaction, retainerId: string, actorId: string | null): Promise<number> {
    return this.center.resolve(tx, renewalClosed(retainerId, 'done', actorId));
  }

  /** The retainer was archived: the renewal reminder no longer applies. */
  retainerArchived(tx: Transaction, retainerId: string, actorId: string): Promise<number> {
    return this.center.resolve(tx, renewalClosed(retainerId, 'void', actorId));
  }

  /** P2A rule 6: the cycle closed, so its behind reminders no longer apply. */
  cycleClosed(tx: Transaction, retainerId: string, actorId: string | null): Promise<number> {
    return this.center.resolve(tx, {
      subject: { type: 'retainer', id: retainerId },
      types: ['retainer_behind'],
      outcome: 'void',
      actorId,
    });
  }

  /** A contract or one of its annexes was signed or voided: the account manager, GMs, Finance. */
  async contract(
    tx: Transaction,
    type: 'contract_signed' | 'contract_voided',
    retainerId: string,
    document: { contract: string; annex: number | null },
    actorId: string,
  ): Promise<void> {
    const retainer = await this.retainer(tx, retainerId);
    if (!retainer) return;
    const [managers, finance] = await Promise.all([
      this.users.withRole('general_manager', tx),
      this.users.withRole('finance', tx),
    ]);
    await this.center.notify(tx, {
      type,
      recipients: [retainer.client.accountManagerId, ...managers, ...finance],
      actorId,
      subjectId: retainerId,
      data: { retainer: retainer.name, client: retainer.client.name, ...document },
    } as Notice);
  }

  private async retainer(executor: Database | Transaction, id: string) {
    const [row] = await executor
      .select({
        name: retainers.name,
        clientId: retainers.clientId,
        departments: retainers.departments,
      })
      .from(retainers)
      .where(eq(retainers.id, id));
    const client = row && (await this.clients.summary(row.clientId, executor));
    return row && client ? { ...row, client } : null;
  }
}
