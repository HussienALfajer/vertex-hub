import { Injectable } from '@nestjs/common';
import type { Audience, DepartmentCode } from '@vertex-hub/contracts';
import type { Database, Transaction } from '@vertex-hub/db';
import { UserDirectory } from '../auth/index.js';
import { ClientDirectory } from '../clients/index.js';
import { PostTeams } from '../content/index.js';
import { EngagementDirectory } from '../projects/index.js';
import { TaskLinks } from '../tasks/index.js';

type Executor = Database | Transaction;

/**
 * F16 rule D1 (ADR 0038): the one resolver of audiences. Teams are derived when resolved, through
 * the exported services of `auth`, `projects`, `tasks`, `content` and `clients`; none of them
 * depends on this module. Announcements use it first; the board, chat and portal reuse it.
 */
@Injectable()
export class AudienceResolver {
  constructor(
    private readonly users: UserDirectory,
    private readonly engagements: EngagementDirectory,
    private readonly tasks: TaskLinks,
    private readonly posts: PostTeams,
    private readonly clients: ClientDirectory,
  ) {}

  /**
   * The active users of the union of the audience's sources, minus `exclude`, sorted by id.
   * A project's team: its manager, its client's account manager, the assignees of its open tasks
   * and the managers of its departments. A client's team: its account manager, the managers of
   * its projects not completed or cancelled, the assignees of its open tasks and the
   * responsible persons of its open posts.
   */
  async resolve(tx: Executor, audience: Audience): Promise<string[]> {
    const people = await this.users.activeOf(
      {
        everyone: audience.everyone,
        departments: audience.departments,
        roles: audience.roles,
        users: audience.users,
      },
      tx,
    );
    const team = new Set<string>();
    const projectIds = audience.projects ?? [];
    const clientIds = audience.clients ?? [];
    if (projectIds.length > 0) {
      const projects = await this.engagements.teams(projectIds, tx);
      const departments = new Set<DepartmentCode>(projects.flatMap((p) => p.departments));
      const managers = await this.users.departmentManagers([...departments], tx);
      const clients = await this.clients.summaries(
        projects.map((project) => project.clientId),
        tx,
      );
      for (const project of projects) {
        team.add(project.projectManagerId);
        const accountManager = clients.get(project.clientId)?.accountManagerId;
        if (accountManager) team.add(accountManager);
        for (const code of project.departments) {
          for (const id of managers.get(code) ?? []) team.add(id);
        }
      }
      for (const id of await this.tasks.openAssignees(
        { projectIds: projects.map((p) => p.id) },
        tx,
      )) {
        team.add(id);
      }
    }
    if (clientIds.length > 0) {
      const clients = await this.clients.summaries([...clientIds], tx);
      const live = [...clients.values()].filter((client) => !client.archived);
      const ids = live.map((client) => client.id);
      for (const client of live) team.add(client.accountManagerId);
      for (const id of await this.engagements.openProjectManagers(ids, tx)) team.add(id);
      for (const id of await this.tasks.openAssignees({ clientIds: ids }, tx)) team.add(id);
      for (const id of await this.posts.openResponsibles(ids, tx)) team.add(id);
    }
    const members = new Set([...people, ...(await this.users.activeIds([...team], tx))]);
    for (const id of audience.exclude ?? []) members.delete(id);
    return [...members].sort();
  }
}
