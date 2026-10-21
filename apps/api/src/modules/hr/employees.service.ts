import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  currentSalary,
  EMPLOYEE_PERSONAL_FIELDS,
  type EmployeeFile,
  type EmployeeListQuery,
  type EmployeePage,
  type EmployeeSummary,
  type EndService,
  employeeStatus,
  fileDatesValid,
  NATIONAL_ID_AUDIT_MASK,
  type NotificationType,
  type Payout,
  type UpdateEmployeeFile,
} from '@vertex-hub/contracts';
import {
  type Database,
  employeeFiles,
  salaryChanges,
  type Transaction,
  workSchedules,
} from '@vertex-hub/db';
import { asc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, UserDirectory, type UserProfile } from '../auth/index.js';
import { NotificationCenter } from '../notifications/index.js';
import { type FileView, fileView, holdsAll } from './employee-access.js';
import { EmployeeFiles } from './employee-files.js';

type Executor = Database | Transaction;

export type EmployeeFileRow = typeof employeeFiles.$inferSelect;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** The reminders an end date raises (rule A7), resolved when it changes or the service ends. */
const CONTRACT_TYPES: readonly NotificationType[] = ['contract_ending'];
const PROBATION_TYPES: readonly NotificationType[] = ['probation_ending'];

/** The salary rows `currentSalary` reads. */
interface SalaryRow {
  userId: string;
  effectiveOn: string;
  amountMinor: number;
  currency: 'USD' | 'SYP';
  archivedAt: Date | null;
}

/**
 * Employee files (spec F17 part A): People, the file with its sections by rule A2, its edits by
 * `employees.manage`, the payout method by `payouts.manage` and the end of service (rule A8).
 */
@Injectable()
export class EmployeesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly files: EmployeeFiles,
    private readonly center: NotificationCenter,
  ) {}

  async list(actor: CurrentUserInfo, query: EmployeeListQuery): Promise<EmployeePage> {
    const view: FileView = {
      file: holdsAll(actor, 'employees.read'),
      pay: holdsAll(actor, 'salaries.read'),
    };
    if (!view.file && !view.pay) throw new ForbiddenException();
    const profiles = await this.users.profiles({
      search: query.search,
      departmentId: query.departmentId,
      archived: query.status === 'ended',
    });
    await this.files.ensure(this.db, profiles);
    const loaded = await this.load(
      this.db,
      profiles.map((profile) => profile.id),
    );
    const matching = profiles.filter((profile) => {
      const file = loaded.files.get(profile.id);
      return !!file && this.statusOf(profile, file) === query.status;
    });
    const start = (query.page - 1) * query.pageSize;
    return {
      items: matching.slice(start, start + query.pageSize).map((profile) => {
        const { personal: _personal, ...summary } = this.toFile(profile, loaded, view);
        return summary as EmployeeSummary;
      }),
      total: matching.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(actor: CurrentUserInfo, userId: string): Promise<EmployeeFile> {
    const view = fileView(actor, userId);
    if (!view) throw new NotFoundException();
    return this.read(this.db, userId, view);
  }

  async update(
    actor: CurrentUserInfo,
    userId: string,
    input: UpdateEmployeeFile,
  ): Promise<EmployeeFile> {
    await this.db.transaction(async (tx) => {
      const file = await this.lockLive(tx, userId);
      const { scheduleId, ...fields } = input;
      if (scheduleId !== undefined && scheduleId !== file.scheduleId) {
        const [schedule] = await tx
          .select({ archivedAt: workSchedules.archivedAt })
          .from(workSchedules)
          .where(eq(workSchedules.id, scheduleId))
          // Holds off archiving it until the assignment commits (rule B2).
          .for('share');
        if (!schedule) throw new NotFoundException('Unknown schedule');
        if (schedule.archivedAt) {
          throw new CodedException(409, 'SCHEDULE_ARCHIVED', 'The schedule is archived');
        }
      }
      const merged = { ...file, ...fields };
      if (!fileDatesValid(merged)) {
        throw new CodedException(
          400,
          'INVALID_DATES',
          'Probation and contract end on or after the start date',
        );
      }
      const change = changedFields(file, { ...fields, scheduleId });
      if (!change) return;
      await tx.update(employeeFiles).set(change.after).where(eq(employeeFiles.id, file.id));
      // Personal fields are named, never logged with their values.
      const masked = (values: Partial<EmployeeFileRow>) =>
        Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            (EMPLOYEE_PERSONAL_FIELDS as readonly string[]).includes(key)
              ? NATIONAL_ID_AUDIT_MASK
              : value,
          ]),
        );
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'employee_file.updated',
        entityType: 'employee_file',
        entityId: userId,
        before: masked(change.before),
        after: masked(change.after),
      });
      // Rule A7: a changed date resolves its reminders; the daily job reminds of the new one.
      const changedTypes = [
        ...('contractEndDate' in change.after ? CONTRACT_TYPES : []),
        ...('probationEndDate' in change.after ? PROBATION_TYPES : []),
      ];
      await this.center.resolve(tx, {
        subject: { type: 'user', id: userId },
        types: changedTypes,
        outcome: 'void',
        actorId: actor.id,
      });
    });
    return this.read(this.db, userId, { file: true, pay: holdsAll(actor, 'salaries.read') });
  }

  /** Rule A5. */
  async setPayout(actor: CurrentUserInfo, userId: string, input: Payout): Promise<EmployeeFile> {
    await this.db.transaction(async (tx) => {
      const file = await this.lockLive(tx, userId);
      const change = changedFields(file, {
        payoutMethod: input.method,
        payoutInstitution: input.institution,
        payoutAccount: input.account,
        payoutHolder: input.holder,
      });
      if (!change) return;
      await tx.update(employeeFiles).set(change.after).where(eq(employeeFiles.id, file.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'employee_file.payout_changed',
        entityType: 'employee_file',
        entityId: userId,
        ...change,
      });
    });
    return this.read(this.db, userId, {
      file: holdsAll(actor, 'employees.read'),
      pay: true,
    });
  }

  /**
   * Rule A8: the last working day, today or later. GMs, Ops and the managers of the employee's
   * departments are told; the contract and probation reminders close; the daily job archives
   * the account the day after.
   */
  async endService(
    actor: CurrentUserInfo,
    userId: string,
    input: EndService,
  ): Promise<EmployeeFile> {
    await this.db.transaction(async (tx) => {
      const file = await this.lockLive(tx, userId);
      if (file.endedOn) {
        throw new CodedException(409, 'ALREADY_ENDED', 'The service end is already set');
      }
      if (input.endedOn < businessDate() || (file.startDate && input.endedOn < file.startDate)) {
        throw new CodedException(
          400,
          'INVALID_DATES',
          'The last working day is today or later, and not before the start date',
        );
      }
      const after = {
        endedOn: input.endedOn,
        endReason: input.reason,
        endNote: input.note ?? null,
      };
      await tx.update(employeeFiles).set(after).where(eq(employeeFiles.id, file.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'employee_file.service_ended',
        entityType: 'employee_file',
        entityId: userId,
        after,
      });
      const [profile] = await this.users.profiles({ ids: [userId] }, tx);
      const managers = await this.users.departmentManagers(
        [
          'internal_operations',
          ...(profile?.departments.map((department) => department.code) ?? []),
        ],
        tx,
      );
      await this.center.notify(
        tx,
        {
          type: 'employee_leaving',
          data: { employee: profile?.name ?? '', endedOn: input.endedOn },
          recipients: [
            ...(await this.users.withRole('general_manager', tx)),
            ...[...managers.values()].flat(),
          ].filter((id) => id !== userId),
          actorId: actor.id,
          subjectId: userId,
        },
        [
          {
            subject: { type: 'user', id: userId },
            types: [...CONTRACT_TYPES, ...PROBATION_TYPES],
            outcome: 'void',
            actorId: actor.id,
          },
        ],
      );
    });
    return this.read(this.db, userId, { file: true, pay: holdsAll(actor, 'salaries.read') });
  }

  /** Rule A8: clearing the end before the account is archived undoes it. */
  async clearEnd(actor: CurrentUserInfo, userId: string): Promise<EmployeeFile> {
    await this.db.transaction(async (tx) => {
      const file = await this.lockLive(tx, userId);
      if (!file.endedOn) return;
      const before = { endedOn: file.endedOn, endReason: file.endReason, endNote: file.endNote };
      await tx
        .update(employeeFiles)
        .set({ endedOn: null, endReason: null, endNote: null })
        .where(eq(employeeFiles.id, file.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'employee_file.service_end_cleared',
        entityType: 'employee_file',
        entityId: userId,
        before,
        after: { endedOn: null, endReason: null, endNote: null },
      });
    });
    return this.read(this.db, userId, { file: true, pay: holdsAll(actor, 'salaries.read') });
  }

  /** The file of a live account, locked; 404 for no such user, 409 once archived. */
  async lockLive(tx: Transaction, userId: string): Promise<EmployeeFileRow> {
    const file = await this.lock(tx, userId);
    if (file.archivedAt) {
      throw new CodedException(409, 'USER_ARCHIVED', 'Restore the user before changing them');
    }
    return file;
  }

  /** The file of a user, locked and created if missing; 404 for no such user. */
  async lock(tx: Transaction, userId: string): Promise<EmployeeFileRow> {
    const [profile] = await this.users.profiles({ ids: [userId] }, tx);
    if (!profile) throw new NotFoundException();
    await this.files.ensure(tx, [profile]);
    const [file] = await tx
      .select()
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, userId))
      .for('update');
    if (!file) throw new NotFoundException();
    return file;
  }

  private async read(executor: Executor, userId: string, view: FileView): Promise<EmployeeFile> {
    const [profile] = await this.users.profiles({ ids: [userId] }, executor);
    if (!profile) throw new NotFoundException();
    await this.files.ensure(executor, [profile]);
    const loaded = await this.load(executor, [userId]);
    return this.toFile(profile, loaded, view);
  }

  private async load(executor: Executor, userIds: string[]) {
    if (userIds.length === 0) {
      return {
        files: new Map<string, EmployeeFileRow>(),
        schedules: new Map<string, string>(),
        salaries: [] as SalaryRow[],
      };
    }
    const files = await executor
      .select()
      .from(employeeFiles)
      .where(inArray(employeeFiles.userId, userIds));
    const scheduleIds = [...new Set(files.map((file) => file.scheduleId))];
    const [schedules, salaries] = await Promise.all([
      executor
        .select({ id: workSchedules.id, name: workSchedules.name })
        .from(workSchedules)
        .where(inArray(workSchedules.id, scheduleIds)),
      executor
        .select({
          userId: salaryChanges.userId,
          effectiveOn: salaryChanges.effectiveOn,
          amountMinor: salaryChanges.amountMinor,
          currency: salaryChanges.currency,
          archivedAt: salaryChanges.archivedAt,
        })
        .from(salaryChanges)
        .where(inArray(salaryChanges.userId, userIds))
        .orderBy(asc(salaryChanges.effectiveOn)),
    ]);
    return {
      files: new Map(files.map((file) => [file.userId, file])),
      schedules: new Map(schedules.map((schedule) => [schedule.id, schedule.name])),
      salaries: salaries as SalaryRow[],
    };
  }

  private statusOf(profile: UserProfile, file: EmployeeFileRow) {
    return employeeStatus({ archived: profile.archived, endedOn: file.endedOn });
  }

  private toFile(
    profile: UserProfile,
    loaded: Awaited<ReturnType<EmployeesService['load']>>,
    view: FileView,
  ): EmployeeFile {
    const file = loaded.files.get(profile.id);
    if (!file) throw new NotFoundException();
    const result: EmployeeFile = {
      userId: profile.id,
      name: profile.name,
      title: profile.title,
      departments: profile.departments,
      status: this.statusOf(profile, file),
    };
    if (view.file) {
      result.personal = {
        nationalId: file.nationalId,
        birthDate: file.birthDate,
        address: file.address,
        emergencyName: file.emergencyName,
        emergencyPhone: file.emergencyPhone,
        emergencyRelation: file.emergencyRelation,
      };
      result.employment = {
        employmentType: file.employmentType,
        startDate: file.startDate,
        probationEndDate: file.probationEndDate,
        contractEndDate: file.contractEndDate,
        schedule: { id: file.scheduleId, name: loaded.schedules.get(file.scheduleId) ?? '' },
        attendanceExempt: file.attendanceExempt,
        remoteWeekdays: file.remoteWeekdays,
        annualLeaveDays: file.annualLeaveDays,
        endedOn: file.endedOn,
        endReason: file.endReason,
        endNote: file.endNote,
      };
    }
    if (view.pay) {
      const changes = loaded.salaries
        .filter((salary) => salary.userId === profile.id)
        .map((salary) => ({ ...salary, archived: !!salary.archivedAt }));
      result.pay = {
        payoutMethod: file.payoutMethod,
        payoutInstitution: file.payoutInstitution,
        payoutAccount: file.payoutAccount,
        payoutHolder: file.payoutHolder,
        currentSalary: currentSalary(changes, businessDate()),
      };
    }
    return result;
  }
}
