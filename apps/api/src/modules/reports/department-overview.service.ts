import { Injectable, NotFoundException } from '@nestjs/common';
import { businessDate, type DepartmentOverview, weekOf } from '@vertex-hub/contracts';
import { CodedException } from '../../core/errors/index.js';
import { type CurrentUserInfo, UserDirectory } from '../auth/index.js';
import { CatalogDirectory } from '../catalog/index.js';
import { LeaveDirectory } from '../hr/index.js';
import { EngagementReports } from '../projects/index.js';
import { TaskReports } from '../tasks/index.js';
import { reportDepartments } from './report-access.js';

/**
 * A department page's overview (F23 rules 24–26): counts for everyone; the members' workload and
 * who is on leave today for `reports.read` covering the department.
 */
@Injectable()
export class DepartmentOverviewService {
  constructor(
    private readonly users: UserDirectory,
    private readonly tasks: TaskReports,
    private readonly catalog: CatalogDirectory,
    private readonly engagements: EngagementReports,
    private readonly leave: LeaveDirectory,
  ) {}

  async overview(
    actor: CurrentUserInfo,
    id: string,
    now: Date = new Date(),
  ): Promise<DepartmentOverview> {
    const department = await this.users.department(id);
    if (!department) throw new NotFoundException();
    if (department.archived) {
      throw new CodedException(
        409,
        'DEPARTMENT_ARCHIVED',
        'An archived department has no overview',
      );
    }
    const today = businessDate(now);
    const week = weekOf(today);
    const [tasks, [counts], services, engagements] = await Promise.all([
      this.tasks.department(department.code, now),
      this.tasks.departmentCounts([department.code], now).then((map) => [...map.values()]),
      this.catalog.activeServiceCount(department.code),
      this.engagements.departmentCounts(department.code),
    ]);
    const overview: DepartmentOverview = {
      week,
      byStatus: tasks.byStatus,
      overdue: tasks.overdue.count,
      dueThisWeek: counts?.dueThisWeek ?? 0,
      unassigned: tasks.unassigned,
      services,
      ...engagements,
    };
    if (reportDepartments(actor, [department.code]).length === 0) return overview;
    // F17: on the company calendar's terms, the dates only, never the leave type.
    const leaves = await this.leave.approved({
      from: today,
      to: today,
      userIds: tasks.people.map((person) => person.user.id),
    });
    const people = new Map(tasks.people.map((person) => [person.user.id, person.user]));
    return {
      ...overview,
      members: tasks.people,
      onLeave: leaves.flatMap((leave) => {
        const user = people.get(leave.userId);
        return user ? [{ user, startsOn: leave.startsOn, endsOn: leave.endsOn }] : [];
      }),
    };
  }
}
