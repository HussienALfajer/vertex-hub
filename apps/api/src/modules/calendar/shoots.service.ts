import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  addDays,
  businessInstant,
  CALENDAR_LIMITS,
  type CreateShoot,
  calendarDay,
  type ScheduleConflict,
  SHOOT_DEPARTMENT,
  type Shoot,
  type ShootDetail,
  type ShootListQuery,
  type ShootPage,
  type Shot,
  type ShotListInput,
  shootTaskTitle,
  type UpdateShoot,
} from '@vertex-hub/contracts';
import { type Database, shootCrew, shootShots, shoots, type Transaction } from '@vertex-hub/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { changedFields, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, lockAccessChanges, UserDirectory } from '../auth/index.js';
import { ClientDirectory, type ClientSummary } from '../clients/index.js';
import type { Notice } from '../notifications/index.js';
import { type ShootTask, ShootTasks, TaskGuards } from '../tasks/index.js';
import { bookingKey, ScheduleConflicts } from './schedule-conflicts.js';
import {
  actorOf,
  assertScheduled,
  assertShootScope,
  type CrewRow,
  coversClient,
  crewOf,
  holdsAll,
  readableShoot,
  type ShootRow,
} from './shoot-access.js';
import { type NoticeShoot, ShootNotices } from './shoot-notices.js';

type Executor = Database | Transaction;

type CrewInput = CreateShoot['crew'];

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

/** A crew member as the audit log records it. */
const crewEntry = (member: { userId: string; role: string; isLead: boolean }) => ({
  userId: member.userId,
  role: member.role,
  isLead: member.isLead,
});

/** Same members, roles and lead, in any order. */
const sameCrew = (a: readonly CrewRow[] | CrewInput, b: readonly CrewRow[] | CrewInput) =>
  JSON.stringify(a.map(crewEntry).sort((x, y) => x.userId.localeCompare(y.userId))) ===
  JSON.stringify(b.map(crewEntry).sort((x, y) => x.userId.localeCompare(y.userId)));

const leadOf = <Member extends { isLead: boolean }>(crew: readonly Member[]) =>
  crew.find((member) => member.isLead);

/** Shoots (spec F11): list, detail, booking, edits, the shot list, archive and restore. */
@Injectable()
export class ShootsService implements OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly clients: ClientDirectory,
    private readonly shootTasks: ShootTasks,
    private readonly guards: TaskGuards,
    private readonly conflicts: ScheduleConflicts,
    private readonly notices: ShootNotices,
  ) {}

  onModuleInit(): void {
    // Rule 9: a scheduled shoot holds its task in Photography until it is cancelled.
    this.guards.register({
      held: async (tx, taskIds) =>
        (
          await tx
            .select({ taskId: shoots.taskId, title: shoots.title })
            .from(shoots)
            .where(
              and(
                inArray(shoots.taskId, [...taskIds]),
                eq(shoots.status, 'scheduled'),
                isNull(shoots.archivedAt),
              ),
            )
        ).map((row) => ({ taskId: row.taskId, title: row.title })),
    });
  }

  async list(actor: CurrentUserInfo, query: ShootListQuery): Promise<ShootPage> {
    if (query.archived && !holdsAll(actor, 'shoots.manage')) throw new ForbiddenException();
    const filters: (SQL | undefined)[] = [
      query.archived ? isNotNull(shoots.archivedAt) : isNull(shoots.archivedAt),
      query.status ? inArray(shoots.status, query.status) : undefined,
      query.from ? gte(shoots.startsAt, businessInstant(query.from, '00:00')) : undefined,
      query.to ? lt(shoots.startsAt, businessInstant(addDays(query.to, 1), '00:00')) : undefined,
      query.clientId ? eq(shoots.clientId, query.clientId) : undefined,
      query.taskId ? eq(shoots.taskId, query.taskId) : undefined,
      query.userId
        ? inArray(
            shoots.id,
            this.db
              .select({ id: shootCrew.shootId })
              .from(shootCrew)
              .where(eq(shootCrew.userId, query.userId === 'me' ? actor.id : query.userId)),
          )
        : undefined,
      query.q
        ? or(
            ilike(shoots.title, `%${escapeLike(query.q)}%`),
            ilike(shoots.location, `%${escapeLike(query.q)}%`),
          )
        : undefined,
    ];
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      this.db
        .select()
        .from(shoots)
        .where(where)
        .orderBy(desc(shoots.startsAt), asc(shoots.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(shoots).where(where),
    ]);
    return {
      items: await this.present(rows),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Shoots as the calendar and the lists show them, in the order given. */
  async present(rows: readonly ShootRow[], executor: Executor = this.db): Promise<Shoot[]> {
    const ids = rows.map((row) => row.id);
    const [crews, clients] = await Promise.all([
      crewOf(executor, ids),
      this.clients.summaries(
        rows.flatMap((row) => (row.clientId ? [row.clientId] : [])),
        executor,
      ),
    ]);
    const people = await this.users.summaries(
      [...crews.values()].flat().map((member) => member.userId),
      executor,
    );
    const conflicts = await this.conflicts.find(
      rows
        .filter((row) => row.status === 'scheduled' && !row.archivedAt)
        .map((row) => ({
          kind: 'shoot' as const,
          id: row.id,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          userIds: (crews.get(row.id) ?? []).map((member) => member.userId),
        })),
      executor,
    );
    return rows.map((row) => {
      const crew = crews.get(row.id) ?? [];
      const lead = leadOf(crew) ?? crew[0];
      const client = row.clientId ? clients.get(row.clientId) : undefined;
      const leadUser = lead ? people.get(lead.userId) : undefined;
      return {
        id: row.id,
        title: row.title,
        type: row.type,
        status: row.status,
        client: client ? { id: client.id, name: client.name, archived: client.archived } : null,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
        location: row.location,
        lead: {
          id: lead?.userId ?? row.createdById,
          name: leadUser?.name ?? '',
          archived: leadUser?.archived ?? false,
        },
        crewCount: crew.length + row.externalCrew.length,
        conflict: (conflicts.get(bookingKey({ kind: 'shoot', id: row.id }))?.length ?? 0) > 0,
        archivedAt: row.archivedAt?.toISOString() ?? null,
      };
    });
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<ShootDetail> {
    const shoot = await readableShoot(this.db, actor, id);
    const [[item], crews, shots, tasks, dependents, client] = await Promise.all([
      this.present([shoot]),
      crewOf(this.db, [id]),
      this.db
        .select()
        .from(shootShots)
        .where(eq(shootShots.shootId, id))
        .orderBy(asc(shootShots.position)),
      this.shootTasks.summaries([
        shoot.taskId,
        ...(shoot.editingTaskId ? [shoot.editingTaskId] : []),
      ]),
      this.shootTasks.dependentCounts([shoot.taskId]),
      shoot.clientId ? this.clients.summary(shoot.clientId) : null,
    ]);
    const crew = crews.get(id) ?? [];
    const people = await this.users.summaries([
      ...crew.map((member) => member.userId),
      shoot.createdById,
      ...(shoot.completedById ? [shoot.completedById] : []),
      ...shots.flatMap((shot) => (shot.doneById ? [shot.doneById] : [])),
    ]);
    const task = tasks.get(shoot.taskId);
    if (!item || !task) throw new NotFoundException();
    const editingTask = shoot.editingTaskId ? tasks.get(shoot.editingTaskId) : undefined;
    const person = (userId: string) => ({ id: userId, name: people.get(userId)?.name ?? '' });
    const live = shoot.status === 'scheduled' && !shoot.archivedAt;
    const scope = coversClient(actor, 'shoots.manage', client);
    const isLead = leadOf(crew)?.userId === actor.id;
    const inCrew = crew.some((member) => member.userId === actor.id);
    const summary = (t: ShootTask) => ({
      id: t.id,
      title: t.title,
      department: t.department,
      status: t.status,
    });
    return {
      ...item,
      mapUrl: shoot.mapUrl,
      brief: shoot.brief,
      crew: crew.map((member) => ({
        user: {
          ...person(member.userId),
          archived: people.get(member.userId)?.archived ?? false,
        },
        role: member.role,
        isLead: member.isLead,
      })),
      externalCrew: shoot.externalCrew.map((member) => ({
        ...member,
        phone: member.phone ?? null,
      })),
      shots: shots.map((shot) => toShot(shot, person)),
      task: { ...summary(task), dependentCount: dependents.get(task.id) ?? 0 },
      editingTask: editingTask ? summary(editingTask) : null,
      conflicts: live ? await this.conflictsOf(shoot, crew) : [],
      closeNote: shoot.closeNote,
      rawFilesUrl: shoot.rawFilesUrl,
      completedAt: shoot.completedAt?.toISOString() ?? null,
      completedBy: shoot.completedById ? person(shoot.completedById) : null,
      cancelledAt: shoot.cancelledAt?.toISOString() ?? null,
      cancelReason: shoot.cancelReason,
      createdBy: person(shoot.createdById),
      createdAt: shoot.createdAt.toISOString(),
      updatedAt: shoot.updatedAt.toISOString(),
      permissions: {
        canEdit: live && scope,
        canTick: live && (scope || inCrew),
        canClose: live && (scope || isLead) && shoot.startsAt.getTime() <= Date.now(),
        canCancel: live && scope,
        canReopen: shoot.status === 'cancelled' && !shoot.archivedAt && scope,
        canArchive: holdsAll(actor, 'shoots.manage'),
      },
    };
  }

  /** Rules 1–6: books a shoot on an existing task or with a new shoot task. */
  async create(actor: CurrentUserInfo, input: CreateShoot): Promise<ShootDetail> {
    const id = await this.db.transaction(async (tx) => {
      // Serialized with archiving users: the crew must stay active (F01 change).
      await lockAccessChanges(tx);
      let task: ShootTask | null = null;
      let client: ClientSummary | null = null;
      if (input.taskId) {
        task = await this.shootTasks.lock(tx, input.taskId);
        if (!task) throw new NotFoundException();
        client = task.clientId ? await this.clients.summary(task.clientId, tx) : null;
        assertShootScope(actor, client);
        await this.assertBookable(tx, task);
      } else {
        client = input.clientId ? await this.clients.summary(input.clientId, tx) : null;
        if (input.clientId && !client) throw new NotFoundException();
        assertShootScope(actor, client);
      }
      if (client?.archived) {
        throw new CodedException(409, 'CLIENT_ARCHIVED', 'The client is archived');
      }
      await this.assertCrew(tx, input.crew, []);
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      const accepted = await this.conflicts.check(
        tx,
        { kind: 'shoot', id: null, startsAt, endsAt, userIds: input.crew.map((m) => m.userId) },
        input.acceptConflicts,
      );
      const day = calendarDay(startsAt);
      if (task) {
        await this.shootTasks.setDueDate(tx, task, day, actorOf(actor));
      } else {
        const lead = leadOf(input.crew);
        const leadInPhotography =
          !!lead && !!(await this.users.activeMember(lead.userId, SHOOT_DEPARTMENT, tx));
        task = await this.shootTasks.createShootTask(tx, actor, {
          title: shootTaskTitle(input.title),
          clientId: client?.id ?? null,
          links: {
            projectId: input.newTask?.projectId ?? null,
            milestoneId: input.newTask?.milestoneId ?? null,
            retainerCycleId: input.newTask?.retainerCycleId ?? null,
            cycleLineId: input.newTask?.cycleLineId ?? null,
          },
          dueDate: day,
          assigneeId: leadInPhotography && lead ? lead.userId : null,
        });
      }
      const values = {
        title: input.title,
        type: input.type,
        clientId: client?.id ?? null,
        taskId: task.id,
        startsAt,
        endsAt,
        location: input.location,
        mapUrl: input.mapUrl,
        brief: input.brief,
        externalCrew: input.externalCrew,
      };
      const [created] = await tx
        .insert(shoots)
        .values({ ...values, createdById: actor.id })
        .returning();
      if (!created) throw new Error('Shoot insert returned no row');
      await tx
        .insert(shootCrew)
        .values(input.crew.map((member) => ({ shootId: created.id, ...member })));
      if (input.shots.length > 0) {
        await tx.insert(shootShots).values(
          input.shots.map((shot, index) => ({
            shootId: created.id,
            position: index + 1,
            text: shot.text,
            note: shot.note,
          })),
        );
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.created',
        entityType: 'shoot',
        entityId: created.id,
        after: {
          ...values,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          crew: input.crew.map(crewEntry),
          ...(input.shots.length > 0 && { shots: input.shots.map((shot) => shot.text) }),
          ...(accepted.length > 0 && { acceptedConflicts: accepted }),
        },
      });
      await this.notices.send(tx, [
        this.notices.notice(
          noticeShoot(created, client),
          'shoot_booked',
          input.crew.map((member) => member.userId),
          actor.id,
        ),
      ]);
      return created.id;
    });
    return this.detail(actor, id);
  }

  /** Rules 4–6 and 8: edits a scheduled shoot; the shoot task's due date follows its day. */
  async update(actor: CurrentUserInfo, id: string, input: UpdateShoot): Promise<ShootDetail> {
    await this.db.transaction(async (tx) => {
      if (input.crew) await lockAccessChanges(tx);
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
      assertShootScope(actor, client);
      assertScheduled(shoot);
      const crewBefore = (await crewOf(tx, [id])).get(id) ?? [];
      const crewChange = !!input.crew && !sameCrew(crewBefore, input.crew);
      if (input.crew && crewChange) {
        await this.assertCrew(
          tx,
          input.crew,
          crewBefore.map((member) => member.userId),
        );
      }
      const crewAfter = crewChange && input.crew ? input.crew : crewBefore;
      const startsAt = input.startsAt ? new Date(input.startsAt) : shoot.startsAt;
      const endsAt = input.endsAt ? new Date(input.endsAt) : shoot.endsAt;
      const timeChange =
        startsAt.getTime() !== shoot.startsAt.getTime() ||
        endsAt.getTime() !== shoot.endsAt.getTime();

      const fields = changedFields(
        {
          title: shoot.title,
          type: shoot.type,
          startsAt: shoot.startsAt.toISOString(),
          endsAt: shoot.endsAt.toISOString(),
          location: shoot.location,
          mapUrl: shoot.mapUrl,
          brief: shoot.brief,
          externalCrew: shoot.externalCrew,
        },
        {
          title: input.title,
          type: input.type,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          location: input.location,
          mapUrl: input.mapUrl,
          brief: input.brief,
          externalCrew: input.externalCrew,
        },
      );
      if (!fields && !crewChange) return;
      const accepted =
        timeChange || crewChange
          ? await this.conflicts.check(
              tx,
              {
                kind: 'shoot',
                id,
                startsAt,
                endsAt,
                userIds: crewAfter.map((member) => member.userId),
              },
              input.acceptConflicts,
            )
          : [];

      if (fields) {
        await tx
          .update(shoots)
          .set({ ...fields.after, startsAt, endsAt })
          .where(eq(shoots.id, id));
      } else {
        await tx.update(shoots).set({ updatedAt: new Date() }).where(eq(shoots.id, id));
      }
      if (crewChange && input.crew) await this.replaceCrew(tx, id, crewBefore, input.crew);
      if (timeChange) {
        const task = await this.shootTasks.lock(tx, shoot.taskId);
        if (task) await this.shootTasks.setDueDate(tx, task, calendarDay(startsAt), actorOf(actor));
      }
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.updated',
        entityType: 'shoot',
        entityId: id,
        before: {
          ...fields?.before,
          ...(crewChange && { crew: crewBefore.map(crewEntry) }),
        },
        after: {
          ...fields?.after,
          ...(crewChange && { crew: crewAfter.map(crewEntry) }),
          ...(accepted.length > 0 && { acceptedConflicts: accepted }),
        },
      });

      // Who hears: added people are booked, removed ones dropped, the rest told what changed.
      const before = new Set(crewBefore.map((member) => member.userId));
      const after = new Set(crewAfter.map((member) => member.userId));
      const changes = [
        ...(timeChange ? (['time'] as const) : []),
        ...(input.location !== undefined && input.location !== shoot.location
          ? (['location'] as const)
          : []),
        ...(leadOf(crewBefore)?.userId !== leadOf(crewAfter)?.userId ? (['lead'] as const) : []),
      ];
      const updated = noticeShoot({ ...shoot, ...fields?.after, startsAt, endsAt }, client);
      const notices: Notice[] = [
        this.notices.notice(
          updated,
          'shoot_booked',
          [...after].filter((userId) => !before.has(userId)),
          actor.id,
        ),
        this.notices.notice(
          updated,
          'shoot_dropped',
          [...before].filter((userId) => !after.has(userId)),
          actor.id,
          { cause: 'removed' },
        ),
      ];
      if (changes.length > 0) {
        notices.push(
          this.notices.notice(
            updated,
            'shoot_changed',
            [...after].filter((userId) => before.has(userId)),
            actor.id,
            { changes },
          ),
        );
      }
      await this.notices.send(tx, notices);
    });
    return this.detail(actor, id);
  }

  /** Rule 7: saves the whole shot list; kept items keep their ids and ticks. */
  async saveShots(actor: CurrentUserInfo, id: string, input: ShotListInput): Promise<ShootDetail> {
    await this.db.transaction(async (tx) => {
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
      assertShootScope(actor, client);
      assertScheduled(shoot);
      const existing = await tx
        .select()
        .from(shootShots)
        .where(eq(shootShots.shootId, id))
        .orderBy(asc(shootShots.position));
      const known = new Set(existing.map((shot) => shot.id));
      const keptIds = input.shots.flatMap((shot) => (shot.id ? [shot.id] : []));
      if (
        keptIds.some((shotId) => !known.has(shotId)) ||
        new Set(keptIds).size !== keptIds.length
      ) {
        throw new BadRequestException('A shot id is not of this shoot');
      }
      const listOf = (shots: readonly { text: string; note: string | null }[]) =>
        shots.map((shot) => ({ text: shot.text, note: shot.note }));
      const unchanged =
        JSON.stringify(listOf(existing)) === JSON.stringify(listOf(input.shots)) &&
        existing.every((shot, index) => input.shots[index]?.id === shot.id);
      if (unchanged) return;

      const removed = existing.filter((shot) => !keptIds.includes(shot.id)).map((shot) => shot.id);
      if (removed.length > 0) await tx.delete(shootShots).where(inArray(shootShots.id, removed));
      // Kept items move out of the way first, so the new positions never collide.
      if (keptIds.length > 0) {
        await tx
          .update(shootShots)
          .set({ position: sql`${shootShots.position} + ${CALENDAR_LIMITS.shots + 1}` })
          .where(inArray(shootShots.id, keptIds));
      }
      for (const [index, shot] of input.shots.entries()) {
        if (shot.id) {
          await tx
            .update(shootShots)
            .set({ position: index + 1, text: shot.text, note: shot.note })
            .where(eq(shootShots.id, shot.id));
        } else {
          await tx
            .insert(shootShots)
            .values({ shootId: id, position: index + 1, text: shot.text, note: shot.note });
        }
      }
      await tx.update(shoots).set({ updatedAt: new Date() }).where(eq(shoots.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.shots_changed',
        entityType: 'shoot',
        entityId: id,
        before: { shots: existing.map((shot) => shot.text) },
        after: { shots: input.shots.map((shot) => shot.text) },
      });
    });
    return this.detail(actor, id);
  }

  /** Rule 7: team crew and shoot scope tick and untick shots while the shoot is scheduled. */
  async tick(actor: CurrentUserInfo, id: string, shotId: string, done: boolean): Promise<Shot> {
    const shot = await this.db.transaction(async (tx) => {
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      const crew = (await crewOf(tx, [id])).get(id) ?? [];
      const client = shoot.clientId ? await this.clients.summary(shoot.clientId, tx) : null;
      const inCrew = crew.some((member) => member.userId === actor.id);
      if (!inCrew && !coversClient(actor, 'shoots.manage', client)) {
        throw new ForbiddenException();
      }
      const [row] = await tx
        .select()
        .from(shootShots)
        .where(and(eq(shootShots.id, shotId), eq(shootShots.shootId, id)));
      if (!row) throw new NotFoundException();
      assertScheduled(shoot);
      if (!!row.doneAt === done) return row;
      const [updated] = await tx
        .update(shootShots)
        .set(done ? { doneAt: new Date(), doneById: actor.id } : { doneAt: null, doneById: null })
        .where(eq(shootShots.id, shotId))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: done ? 'shoot.shot_ticked' : 'shoot.shot_unticked',
        entityType: 'shoot',
        entityId: id,
        after: { shotId, text: row.text },
      });
      return updated;
    });
    const people = await this.users.summaries(shot.doneById ? [shot.doneById] : []);
    return toShot(shot, (userId) => ({ id: userId, name: people.get(userId)?.name ?? '' }));
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<ShootDetail> {
    if (!holdsAll(actor, 'shoots.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      if (shoot.archivedAt) {
        throw new CodedException(409, 'SHOOT_ARCHIVED', 'The shoot is already archived');
      }
      await tx.update(shoots).set({ archivedAt: new Date() }).where(eq(shoots.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.archived',
        entityType: 'shoot',
        entityId: id,
        before: { archived: false },
        after: { archived: true },
      });
    });
    return this.detail(actor, id);
  }

  /** Back to its status; a scheduled shoot needs its task still bookable. */
  async restore(actor: CurrentUserInfo, id: string): Promise<ShootDetail> {
    if (!holdsAll(actor, 'shoots.manage')) throw new ForbiddenException();
    await this.db.transaction(async (tx) => {
      const shoot = await readableShoot(tx, actor, id, { forUpdate: true });
      if (!shoot.archivedAt) {
        throw new CodedException(409, 'SHOOT_NOT_ARCHIVED', 'The shoot is not archived');
      }
      if (shoot.status === 'scheduled') {
        const task = await this.shootTasks.lock(tx, shoot.taskId);
        if (!task) throw new NotFoundException();
        await this.assertBookable(tx, task, id);
      }
      await tx.update(shoots).set({ archivedAt: null }).where(eq(shoots.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'shoot.restored',
        entityType: 'shoot',
        entityId: id,
        before: { archived: true },
        after: { archived: false },
      });
    });
    return this.detail(actor, id);
  }

  /**
   * Rule 2: an open Photography task that no other active shoot holds (`TASK_NOT_BOOKABLE`).
   * The partial unique index settles two bookings at once (edge case 1).
   */
  async assertBookable(tx: Transaction, task: ShootTask, shootId?: string): Promise<void> {
    const [other] = await tx
      .select({ id: shoots.id })
      .from(shoots)
      .where(
        and(
          eq(shoots.taskId, task.id),
          isNull(shoots.archivedAt),
          ne(shoots.status, 'cancelled'),
          shootId ? ne(shoots.id, shootId) : undefined,
        ),
      );
    if (other || !this.shootTasks.isBookable(task)) {
      throw new CodedException(
        409,
        'TASK_NOT_BOOKABLE',
        'The task is not an open Photography task free of another shoot',
      );
    }
  }

  /** The conflicts of a scheduled shoot's team crew (rule 5). */
  async conflictsOf(
    shoot: Pick<ShootRow, 'id' | 'startsAt' | 'endsAt'>,
    crew: readonly Pick<CrewRow, 'userId'>[],
    executor: Executor = this.db,
  ): Promise<ScheduleConflict[]> {
    return this.conflicts.of(
      {
        kind: 'shoot',
        id: shoot.id,
        startsAt: shoot.startsAt,
        endsAt: shoot.endsAt,
        userIds: crew.map((member) => member.userId),
      },
      executor,
    );
  }

  /**
   * Rule 6: exactly one lead (`LEAD_REQUIRED`); people added are non-archived users
   * (`INVALID_CREW`); members already on the crew may stay after being archived.
   */
  private async assertCrew(
    tx: Transaction,
    crew: CrewInput,
    current: readonly string[],
  ): Promise<void> {
    if (crew.filter((member) => member.isLead).length !== 1) {
      throw new CodedException(400, 'LEAD_REQUIRED', 'A crew has exactly one lead');
    }
    const added = crew.map((member) => member.userId).filter((userId) => !current.includes(userId));
    const people = await this.users.summaries(added, tx);
    if (added.some((userId) => !people.get(userId) || people.get(userId)?.archived)) {
      throw new CodedException(400, 'INVALID_CREW', 'A crew member is archived or unknown');
    }
  }

  /** Removes, updates and adds crew rows; the lead moves last (one lead per shoot). */
  private async replaceCrew(
    tx: Transaction,
    shootId: string,
    before: readonly CrewRow[],
    after: CrewInput,
  ): Promise<void> {
    const kept = after.filter((member) => before.some((row) => row.userId === member.userId));
    const removed = before
      .filter((row) => !after.some((member) => member.userId === row.userId))
      .map((row) => row.userId);
    const added = after.filter((member) => !before.some((row) => row.userId === member.userId));
    const ofShoot = (userIds: string[]) =>
      and(eq(shootCrew.shootId, shootId), inArray(shootCrew.userId, userIds));
    if (removed.length > 0) await tx.delete(shootCrew).where(ofShoot(removed));
    await tx.update(shootCrew).set({ isLead: false }).where(eq(shootCrew.shootId, shootId));
    for (const member of kept) {
      await tx
        .update(shootCrew)
        .set({ role: member.role })
        .where(ofShoot([member.userId]));
    }
    if (added.length > 0) {
      await tx
        .insert(shootCrew)
        .values(added.map((member) => ({ shootId, ...member, isLead: false })));
    }
    const lead = leadOf(after);
    if (lead) {
      await tx
        .update(shootCrew)
        .set({ isLead: true })
        .where(ofShoot([lead.userId]));
    }
  }
}

/** The notice snapshot of a shoot. */
export const noticeShoot = (
  shoot: Pick<ShootRow, 'id' | 'title' | 'startsAt' | 'endsAt' | 'location'>,
  client: ClientSummary | null,
): NoticeShoot => ({
  id: shoot.id,
  title: shoot.title,
  startsAt: shoot.startsAt,
  endsAt: shoot.endsAt,
  location: shoot.location,
  client: client?.name ?? null,
});

const toShot = (
  shot: typeof shootShots.$inferSelect,
  person: (userId: string) => { id: string; name: string },
): Shot => ({
  id: shot.id,
  position: shot.position,
  text: shot.text,
  note: shot.note,
  doneAt: shot.doneAt?.toISOString() ?? null,
  doneBy: shot.doneById ? person(shot.doneById) : null,
});
