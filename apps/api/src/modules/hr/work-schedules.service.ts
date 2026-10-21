import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  businessDate,
  type CreateWorkSchedule,
  scheduleTimesValid,
  type UpdateWorkSchedule,
  WEEKDAYS,
  type WorkSchedule,
  type WorkScheduleDay,
  type WorkScheduleKind,
  type WorkScheduleList,
} from '@vertex-hub/contracts';
import {
  type Database,
  employeeFiles,
  type Transaction,
  workScheduleDays,
  workSchedules,
} from '@vertex-hub/db';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { AttendanceDays } from './attendance-days.js';
import { lockLeave } from './leave-ledger.js';

type Executor = Database | Transaction;

type ScheduleRow = typeof workSchedules.$inferSelect;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

/** `time` columns read as `HH:MM:SS`; the contracts use `HH:MM`. */
const timeOfDay = (value: string) => value.slice(0, 5);

/**
 * Rule B2: named work schedules, read with `hr.read` and managed by `hr.manage`. Exactly one is
 * the default (new files take it, rule A1); the default and a schedule assigned to an active
 * file cannot be archived. The days of a schedule are replaced as a whole on an edit.
 */
@Injectable()
export class WorkSchedulesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly attendanceDays: AttendanceDays,
  ) {}

  /** The non-archived schedules, the default first, then by name. */
  async list(): Promise<WorkScheduleList> {
    const rows = await this.db
      .select()
      .from(workSchedules)
      .where(isNull(workSchedules.archivedAt))
      .orderBy(desc(workSchedules.isDefault), asc(workSchedules.name));
    return { items: await this.toResponses(this.db, rows) };
  }

  async create(actor: CurrentUserInfo, input: CreateWorkSchedule): Promise<WorkSchedule> {
    checkTimes(input.kind, input.days);
    const row = await this.db.transaction(async (tx) => {
      await this.checkName(tx, input.name);
      if (input.isDefault) await this.clearDefault(tx, actor);
      const [created] = await tx
        .insert(workSchedules)
        .values({ name: input.name, kind: input.kind, isDefault: input.isDefault })
        .returning();
      if (!created) throw new Error('Work schedule not created');
      await this.writeDays(tx, created.id, input.days);
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'work_schedule.created',
        entityType: 'work_schedule',
        entityId: created.id,
        after: input,
      });
      return created;
    });
    return this.toResponse(this.db, row);
  }

  async update(
    actor: CurrentUserInfo,
    id: string,
    input: UpdateWorkSchedule,
  ): Promise<WorkSchedule> {
    const row = await this.db.transaction(async (tx) => {
      // The HR locks of the people on it before the schedule's row, as a file edit takes them.
      const userIds = (
        await tx
          .select({ userId: employeeFiles.userId })
          .from(employeeFiles)
          .where(and(eq(employeeFiles.scheduleId, id), isNull(employeeFiles.archivedAt)))
          .orderBy(asc(employeeFiles.userId))
      ).map((file) => file.userId);
      for (const userId of userIds) await lockLeave(tx, userId);
      const [current] = await tx
        .select()
        .from(workSchedules)
        .where(and(eq(workSchedules.id, id), isNull(workSchedules.archivedAt)))
        .for('update');
      if (!current) throw new NotFoundException();
      const days = await this.daysOf(tx, [id]);
      const before = { ...auditFields(current), days: days.get(id) ?? [] };
      const after = { ...before, ...input };
      checkTimes(after.kind, after.days);
      if (current.isDefault && input.isDefault === false) {
        throw new CodedException(
          409,
          'DEFAULT_REQUIRED',
          'Make another schedule the default instead',
        );
      }
      const changes = changedFields(before, input);
      if (!changes) return current;
      if (input.name !== undefined && input.name !== current.name) {
        await this.checkName(tx, input.name, id);
      }
      if (input.isDefault && !current.isDefault) await this.clearDefault(tx, actor);
      const [updated] = await tx
        .update(workSchedules)
        .set({
          name: after.name,
          kind: after.kind,
          isDefault: after.isDefault,
          updatedAt: new Date(),
        })
        .where(eq(workSchedules.id, id))
        .returning();
      if (!updated) throw new NotFoundException();
      if (changes.after.days) {
        await tx.delete(workScheduleDays).where(eq(workScheduleDays.scheduleId, id));
        await this.writeDays(tx, id, changes.after.days);
      }
      // Rule B2 and edge case 10: today's day takes the new hours while it has no punch.
      if (changes.after.days || changes.after.kind) {
        for (const userId of userIds) {
          await this.attendanceDays.refresh(tx, userId, [businessDate()], { refreeze: true });
        }
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'work_schedule.updated',
        entityType: 'work_schedule',
        entityId: id,
        before: changes.before,
        after: changes.after,
      });
      return updated;
    });
    return this.toResponse(this.db, row);
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<WorkSchedule> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(workSchedules)
        .where(eq(workSchedules.id, id))
        .for('update');
      if (!current) throw new NotFoundException();
      if (current.archivedAt) return current;
      if (current.isDefault) {
        throw new CodedException(
          409,
          'DEFAULT_REQUIRED',
          'The default schedule cannot be archived',
        );
      }
      const employees = (await this.employeeCounts(tx, [id])).get(id) ?? 0;
      if (employees > 0) {
        throw new CodedException(409, 'SCHEDULE_IN_USE', 'Employees are on this schedule', {
          employees,
        });
      }
      const [archived] = await tx
        .update(workSchedules)
        .set({ archivedAt: new Date() })
        .where(eq(workSchedules.id, id))
        .returning();
      if (!archived) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'work_schedule.archived',
        entityType: 'work_schedule',
        entityId: id,
        before: { archived: false },
        after: { archived: true, name: current.name },
      });
      return archived;
    });
    return this.toResponse(this.db, row);
  }

  /** Names are unique regardless of case, archived schedules included. */
  private async checkName(tx: Transaction, name: string, exceptId?: string): Promise<void> {
    const [taken] = await tx
      .select({ id: workSchedules.id })
      .from(workSchedules)
      .where(eq(sql`lower(${workSchedules.name})`, name.toLowerCase()));
    if (taken && taken.id !== exceptId) {
      throw new CodedException(409, 'SCHEDULE_NAME_TAKEN', 'Another schedule has this name');
    }
  }

  /** The current default stops being one, audited, before another takes its place. */
  private async clearDefault(tx: Transaction, actor: CurrentUserInfo): Promise<void> {
    const [previous] = await tx
      .update(workSchedules)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(eq(workSchedules.isDefault, true))
      .returning({ id: workSchedules.id });
    if (!previous) return;
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'work_schedule.updated',
      entityType: 'work_schedule',
      entityId: previous.id,
      before: { isDefault: true },
      after: { isDefault: false },
    });
  }

  private async writeDays(
    tx: Transaction,
    scheduleId: string,
    days: readonly WorkScheduleDay[],
  ): Promise<void> {
    await tx.insert(workScheduleDays).values(days.map((day) => ({ scheduleId, ...day })));
  }

  private async daysOf(
    executor: Executor,
    ids: readonly string[],
  ): Promise<Map<string, WorkScheduleDay[]>> {
    const days = new Map<string, WorkScheduleDay[]>();
    if (ids.length === 0) return days;
    const rows = await executor
      .select()
      .from(workScheduleDays)
      .where(inArray(workScheduleDays.scheduleId, [...ids]));
    rows.sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday));
    for (const row of rows) {
      const list = days.get(row.scheduleId) ?? [];
      list.push({
        weekday: row.weekday,
        startTime: timeOfDay(row.startTime),
        latestStartTime: row.latestStartTime ? timeOfDay(row.latestStartTime) : null,
        requiredMinutes: row.requiredMinutes,
      });
      days.set(row.scheduleId, list);
    }
    return days;
  }

  /** The files of active accounts on each schedule. */
  private async employeeCounts(
    executor: Executor,
    ids: readonly string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({ scheduleId: employeeFiles.scheduleId, employees: count() })
      .from(employeeFiles)
      .where(and(inArray(employeeFiles.scheduleId, [...ids]), isNull(employeeFiles.archivedAt)))
      .groupBy(employeeFiles.scheduleId);
    return new Map(rows.map((row) => [row.scheduleId, row.employees]));
  }

  private async toResponse(executor: Executor, row: ScheduleRow): Promise<WorkSchedule> {
    const [response] = await this.toResponses(executor, [row]);
    if (!response) throw new NotFoundException();
    return response;
  }

  private async toResponses(executor: Executor, rows: ScheduleRow[]): Promise<WorkSchedule[]> {
    const ids = rows.map((row) => row.id);
    const [days, employees] = await Promise.all([
      this.daysOf(executor, ids),
      this.employeeCounts(executor, ids),
    ]);
    return rows.map((row) => ({
      ...auditFields(row),
      id: row.id,
      days: days.get(row.id) ?? [],
      employees: employees.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }
}

const auditFields = (row: ScheduleRow) => ({
  name: row.name,
  kind: row.kind,
  isDefault: row.isDefault,
});

function checkTimes(kind: WorkScheduleKind, days: readonly WorkScheduleDay[]): void {
  if (!scheduleTimesValid(kind, days)) {
    throw new CodedException(
      400,
      'INVALID_TIMES',
      'A fixed day has no start window; a flexible window closes after it opens; days end by 23:59',
    );
  }
}
