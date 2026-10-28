import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AssignableRole,
  type CreateUser,
  hasPermission,
  type Image,
  type ProfileChange,
  type Responsibility,
  type SetImage,
  type SkillListResponse,
  type UpdateOwnProfile,
  type UpdateUser,
  type UserDepartment,
  type UserListQuery,
  type UserPage,
  type UserResponse,
  type UserStatus,
  type UserWithLinkResponse,
} from '@vertex-hub/contracts';
import {
  accounts,
  type Database,
  departmentMembers,
  departments,
  newId,
  sessions,
  type Transaction,
  userRoles,
  users,
} from '@vertex-hub/db';
import { SYSTEM_ACTOR } from '@vertex-hub/messages';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, changedFields, recordAudit } from '../audit/index.js';
import { AccountEmails } from './account-emails.js';
import { AccountNotices } from './account-notices.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { resetTwoFactor } from './reset-two-factor.js';
import { ResponsibilityRegistry } from './responsibility-registry.js';
import { UserDirectory } from './user-directory.js';
import { UserImages } from './user-images.js';
import { UserLifecycle } from './user-lifecycle.js';
import { UserLinksService } from './user-links.service.js';
import { hasPassword, lockAccessChanges, statusOf } from './user-status.js';

type Executor = Database | Transaction;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

interface LoadedUser {
  id: string;
  name: string;
  imageId: string | null;
  email: string;
  title: string | null;
  phone: string | null;
  skills: string[];
  status: UserStatus;
  twoFactorEnabled: boolean;
  departments: UserDepartment[];
  roles: AssignableRole[];
}

/** The departments of a user as audit entries show them: names, not only ids. */
interface DepartmentsSnapshot {
  primaryDepartment: { id: string; name: string } | null;
  secondaryDepartments: { id: string; name: string }[];
}

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });
const canManage = (user: CurrentUserInfo) => hasPermission(user.access, 'users.manage');
const isGeneralManager = (user: CurrentUserInfo) => user.access.roles.includes('general_manager');

/** Team directory and user management (F01). Every change is audited in its transaction. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly links: UserLinksService,
    private readonly responsibilities: ResponsibilityRegistry,
    private readonly emails: AccountEmails,
    private readonly notices: AccountNotices,
    private readonly directory: UserDirectory,
    private readonly lifecycle: UserLifecycle,
    private readonly userImages: UserImages,
  ) {}

  async list(actor: CurrentUserInfo, query: UserListQuery): Promise<UserPage> {
    const manager = canManage(actor);
    // Status and assigned roles are for user managers only; managing a department is public.
    const assignedRoleFilter =
      query.role && !['employee', 'department_manager'].includes(query.role);
    if (
      (query.status !== 'active' || assignedRoleFilter || query.hasImage !== undefined) &&
      !manager
    ) {
      throw new ForbiddenException();
    }

    const filters: SQL[] = [sql`${statusOf} = ${query.status}`];
    if (query.search) {
      const pattern = `%${escapeLike(query.search)}%`;
      filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern)) as SQL);
    }
    if (query.departmentId) {
      filters.push(sql`exists (select 1 from ${departmentMembers}
        where ${departmentMembers.userId} = ${users.id}
          and ${departmentMembers.departmentId} = ${query.departmentId})`);
    }
    if (query.role === 'department_manager') {
      filters.push(
        sql`exists (select 1 from ${departments} where ${departments.managerId} = ${users.id})`,
      );
    } else if (query.role && query.role !== 'employee') {
      filters.push(sql`exists (select 1 from ${userRoles}
        where ${userRoles.userId} = ${users.id} and ${userRoles.role} = ${query.role})`);
    }
    if (query.skill) {
      filters.push(sql`exists (select 1 from unnest(${users.skills}) as skill
        where lower(skill) = lower(${query.skill}))`);
    }
    if (query.hasImage !== undefined) {
      filters.push(query.hasImage ? isNotNull(users.imageId) : isNull(users.imageId));
    }
    const where = and(...filters);

    const [rows, [total]] = await Promise.all([
      this.db
        .select({ id: users.id })
        .from(users)
        .where(where)
        .orderBy(asc(users.name), asc(users.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ value: count() }).from(users).where(where),
    ]);
    const loaded = await this.load(
      this.db,
      rows.map((row) => row.id),
    );
    return {
      items: rows.flatMap((row) => {
        const user = loaded.get(row.id);
        return user ? [this.toResponse(user, manager)] : [];
      }),
      total: total?.value ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** Skills in use by users who are not archived, once each regardless of case, sorted. */
  async skills(): Promise<SkillListResponse> {
    const rows = await this.db
      .select({ skills: users.skills })
      .from(users)
      .where(isNull(users.archivedAt));
    const byKey = new Map<string, string>();
    for (const skill of rows.flatMap((row) => row.skills)) {
      const key = skill.toLocaleLowerCase('ar');
      if (!byKey.has(key)) byKey.set(key, skill);
    }
    return { items: [...byKey.values()].sort((a, b) => a.localeCompare(b, 'ar')) };
  }

  async detail(actor: CurrentUserInfo, id: string): Promise<UserResponse> {
    const user = (await this.load(this.db, [id])).get(id);
    if (!user) throw new NotFoundException();
    return this.toResponse(user, canManage(actor));
  }

  async create(actor: CurrentUserInfo, input: CreateUser): Promise<UserWithLinkResponse> {
    const roles = input.roles ?? [];
    if (roles.some(isGeneralManagerGranted) && !isGeneralManager(actor)) {
      throw this.generalManagerOnly();
    }
    const id = newId();
    const link = await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      await this.assertEmailFree(tx, input.email);
      const secondary = input.secondaryDepartmentIds ?? [];
      await this.assertDepartmentsActive(tx, [input.primaryDepartmentId, ...secondary]);
      const profile = {
        name: input.name,
        email: input.email,
        title: input.title ?? null,
        phone: input.phone ?? null,
        skills: input.skills ?? [],
      };
      await tx.insert(users).values({ id, ...profile, emailVerified: true });
      await tx
        .insert(departmentMembers)
        .values([
          { userId: id, departmentId: input.primaryDepartmentId, isPrimary: true },
          ...secondary.map((departmentId) => ({ userId: id, departmentId, isPrimary: false })),
        ]);
      if (roles.length > 0) {
        await tx.insert(userRoles).values(roles.map((role) => ({ userId: id, role })));
      }
      await this.lifecycle.run('created', tx, id, actorOf(actor));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'user.created',
        entityType: 'user',
        entityId: id,
        after: { ...profile, roles, ...(await this.departmentsSnapshot(tx, id)) },
      });
      return this.issueLink(tx, actor, id, 'activation');
    });
    return { user: await this.detail(actor, id), link };
  }

  async update(actor: CurrentUserInfo, id: string, input: UpdateUser): Promise<UserResponse> {
    await this.db.transaction(async (tx) => {
      const current = await this.loadForChange(tx, actor, id);

      const { roles, primaryDepartmentId, secondaryDepartmentIds, ...profile } = input;
      if (profile.email !== undefined && profile.email !== current.email) {
        await this.assertEmailFree(tx, profile.email, id);
      }
      const profileChange = changedFields(
        {
          name: current.name,
          email: current.email,
          title: current.title,
          phone: current.phone,
          skills: current.skills,
        },
        profile,
      );
      if (profileChange) {
        await tx.update(users).set(profileChange.after).where(eq(users.id, id));
        await recordAudit(tx, {
          actor: actorOf(actor),
          action: 'user.updated',
          entityType: 'user',
          entityId: id,
          ...profileChange,
        });
        // F01C rule 19: the user hears of profile edits by someone else; email is an access change.
        await this.notifyProfileChanged(
          tx,
          actor,
          id,
          PROFILE_FIELDS.filter((field) => field in profileChange.after),
        );
      }

      await this.changeDepartments(tx, actor, current, primaryDepartmentId, secondaryDepartmentIds);
      if (roles) await this.changeRoles(tx, actor, current, roles);
    });
    return this.detail(actor, id);
  }

  async issueUserLink(actor: CurrentUserInfo, id: string) {
    return this.db.transaction(async (tx) => {
      const user = await this.loadForChange(tx, actor, id);
      return this.issueLink(tx, actor, id, user.status === 'invited' ? 'activation' : 'reset');
    });
  }

  async archive(actor: CurrentUserInfo, id: string): Promise<UserResponse> {
    await this.db.transaction(async (tx) => {
      const user = await this.loadForChange(tx, actor, id);
      if (id === actor.id) {
        throw new CodedException(409, 'CANNOT_ARCHIVE_SELF', 'You cannot archive yourself');
      }
      await this.archiveLoaded(tx, actorOf(actor), user);
    });
    return this.detail(actor, id);
  }

  /**
   * F17 rule A8: the daily job archives an account whose service ended, as the system. Returns
   * false when it was already archived.
   */
  async archiveBySystem(tx: Transaction, id: string): Promise<boolean> {
    await lockAccessChanges(tx);
    await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update');
    const user = (await this.load(tx, [id])).get(id);
    if (!user) throw new NotFoundException();
    if (user.status === 'archived') return false;
    await this.archiveLoaded(tx, null, user);
    return true;
  }

  /** F01 rule 9 and F16 part C: the archive itself, once the actor's rights are checked. */
  private async archiveLoaded(
    tx: Transaction,
    actor: AuditActor | null,
    user: LoadedUser,
  ): Promise<void> {
    const { id } = user;
    if (user.roles.includes('general_manager') && user.status === 'active') {
      await this.assertAnotherActiveGeneralManager(tx, id);
    }
    this.assertNoResponsibilities(await this.responsibilitiesOf(tx, id));
    const openWork = await this.responsibilities.openWork(tx, id);
    await tx.update(users).set({ archivedAt: new Date() }).where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await this.links.revoke(tx, id);
    // F14 email edge case 6: the only email an archived user gets.
    await this.emails.securityNotice(tx, id, 'archived', actor?.name ?? SYSTEM_ACTOR);
    await this.lifecycle.run('archived', tx, id, actor);
    await recordAudit(tx, {
      actor,
      action: 'user.archived',
      entityType: 'user',
      entityId: id,
      before: { status: user.status },
      after: { status: 'archived' },
    });
    if (openWork > 0) await this.notifyOpenWork(tx, actor?.id ?? null, user, openWork);
  }

  /** Restores an archived user as invited, with a new activation link (F01 rule 11). */
  async restore(actor: CurrentUserInfo, id: string): Promise<UserWithLinkResponse> {
    const link = await this.db.transaction(async (tx) => {
      const user = await this.loadForChange(tx, actor, id, { archived: true });
      if (user.status !== 'archived') {
        throw new CodedException(409, 'USER_NOT_ARCHIVED', 'The user is not archived');
      }
      await tx.update(users).set({ archivedAt: null }).where(eq(users.id, id));
      await this.lifecycle.run('restored', tx, id, actorOf(actor));
      // The user sets a new password through the activation link.
      await tx
        .delete(accounts)
        .where(and(eq(accounts.userId, id), eq(accounts.providerId, 'credential')));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'user.restored',
        entityType: 'user',
        entityId: id,
        before: { status: 'archived' },
        after: { status: 'invited' },
      });
      // F16: the work of a restored member is theirs again.
      await this.notices.send(
        tx,
        [],
        [
          {
            subject: { type: 'user', id },
            types: ['member_archived_open_work'],
            outcome: 'void',
            actorId: actor.id,
          },
        ],
      );
      return this.issueLink(tx, actor, id, 'activation', { restored: true });
    });
    return { user: await this.detail(actor, id), link };
  }

  async resetTwoFactor(actor: CurrentUserInfo, id: string): Promise<UserResponse> {
    await this.db.transaction(async (tx) => {
      await this.loadForChange(tx, actor, id);
      await resetTwoFactor(tx, id, actorOf(actor));
      await this.emails.securityNotice(tx, id, 'two_factor_reset', actor.name);
    });
    return this.detail(actor, id);
  }

  /** A user edits their own phone and skills (F01 rule 19). */
  async updateOwnProfile(actor: CurrentUserInfo, input: UpdateOwnProfile): Promise<UserResponse> {
    await this.db.transaction(async (tx) => {
      await lockAccessChanges(tx);
      const [current] = await tx
        .select({ phone: users.phone, skills: users.skills })
        .from(users)
        .where(eq(users.id, actor.id))
        .for('update');
      if (!current) throw new NotFoundException();
      const change = changedFields(current, input);
      if (!change) return;
      await tx.update(users).set(change.after).where(eq(users.id, actor.id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'user.profile_updated',
        entityType: 'user',
        entityId: actor.id,
        ...change,
      });
    });
    return this.detail(actor, actor.id);
  }

  /** The signed-in user's current photo (F01C), for `GET /api/me`. */
  async imageIdOf(id: string): Promise<string | null> {
    const [row] = await this.db
      .select({ imageId: users.imageId })
      .from(users)
      .where(eq(users.id, id));
    return row?.imageId ?? null;
  }

  /**
   * F01C rules 1, 5 and 18: one's own photo, or another user's for `users.manage` within F01's
   * scope (only a General Manager changes a General Manager's).
   */
  async setImage(actor: CurrentUserInfo, id: string, input: SetImage): Promise<Image> {
    const image = await this.db.transaction(async (tx) => {
      const current = await this.lockForImage(tx, actor, id);
      const stored = await this.userImages.images.set(tx, actor, { type: 'user', id }, input);
      await tx.update(users).set({ imageId: stored.image.id }).where(eq(users.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'user.image_set',
        entityType: 'user',
        entityId: id,
        ...(current.imageId && { before: { imageId: current.imageId } }),
        after: { imageId: stored.image.id, source: stored.source },
      });
      await this.notifyProfileChanged(tx, actor, id, ['photo']);
      return stored.image;
    });
    await this.userImages.images.queueRenders();
    return image;
  }

  /** F01C rule 4: removing when there is no photo changes nothing. */
  async removeImage(actor: CurrentUserInfo, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.lockForImage(tx, actor, id);
      if (!current.imageId) return;
      await this.userImages.images.remove(tx, actor, { type: 'user', id });
      await tx.update(users).set({ imageId: null }).where(eq(users.id, id));
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'user.image_removed',
        entityType: 'user',
        entityId: id,
        before: { imageId: current.imageId },
        after: { imageId: null },
      });
      await this.notifyProfileChanged(tx, actor, id, ['photo']);
    });
  }

  // Helpers

  /**
   * Locks a user whose photo changes: unknown is 404, another user's needs `users.manage` (403)
   * and a General Manager's a General Manager; an archived user's is refused (rule 5).
   */
  private async lockForImage(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
  ): Promise<{ imageId: string | null }> {
    const [user] = await tx
      .select({ imageId: users.imageId, archivedAt: users.archivedAt })
      .from(users)
      .where(eq(users.id, id))
      .for('update');
    if (!user) throw new NotFoundException();
    if (id !== actor.id) {
      if (!canManage(actor)) throw new ForbiddenException();
      const [generalManager] = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(and(eq(userRoles.userId, id), eq(userRoles.role, 'general_manager')));
      if (generalManager && !isGeneralManager(actor)) throw this.generalManagerOnly();
    }
    if (user.archivedAt) {
      throw new CodedException(409, 'USER_ARCHIVED', 'Restore the user before changing them');
    }
    return user;
  }

  /** F01C rules 18–19: `profile_changed` to the user, unless they made the change themselves. */
  private async notifyProfileChanged(
    tx: Transaction,
    actor: CurrentUserInfo,
    userId: string,
    changes: ProfileChange[],
  ): Promise<void> {
    if (changes.length === 0 || actor.id === userId) return;
    await this.notices.send(tx, [
      {
        type: 'profile_changed',
        data: { changes },
        recipients: [userId],
        actorId: actor.id,
        subjectId: userId,
      },
    ]);
  }

  private async load(executor: Executor, ids: string[]): Promise<Map<string, LoadedUser>> {
    if (ids.length === 0) return new Map();
    const [rows, memberships, roles] = await Promise.all([
      executor
        .select({
          id: users.id,
          name: users.name,
          imageId: users.imageId,
          email: users.email,
          title: users.title,
          phone: users.phone,
          skills: users.skills,
          status: statusOf,
          twoFactorEnabled: users.twoFactorEnabled,
        })
        .from(users)
        .where(inArray(users.id, ids)),
      executor
        .select({
          userId: departmentMembers.userId,
          id: departments.id,
          code: departments.code,
          name: departments.name,
          isPrimary: departmentMembers.isPrimary,
          managerId: departments.managerId,
        })
        .from(departmentMembers)
        .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
        .where(inArray(departmentMembers.userId, ids))
        .orderBy(desc(departmentMembers.isPrimary), asc(departments.name)),
      executor
        .select({ userId: userRoles.userId, role: userRoles.role })
        .from(userRoles)
        .where(inArray(userRoles.userId, ids))
        .orderBy(asc(userRoles.role)),
    ]);
    return new Map(
      rows.map((row) => [
        row.id,
        {
          ...row,
          departments: memberships
            .filter((m) => m.userId === row.id)
            .map(({ userId, managerId, ...department }) => ({
              ...department,
              isManager: managerId === userId,
            })),
          roles: roles
            .filter((r) => r.userId === row.id)
            .map((r) => r.role)
            .filter(
              (role): role is AssignableRole =>
                role !== 'employee' && role !== 'department_manager',
            ),
        },
      ]),
    );
  }

  private toResponse(user: LoadedUser, manager: boolean): UserResponse {
    const response: UserResponse = {
      id: user.id,
      name: user.name,
      imageId: user.imageId,
      email: manager || user.status !== 'archived' ? user.email : null,
      title: user.title,
      phone: user.phone,
      skills: user.skills,
      departments: user.departments,
    };
    if (!manager) return response;
    return {
      ...response,
      status: user.status,
      roles: user.roles,
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }

  /**
   * Locks and loads a user an action changes, after the checks every such action shares: the user
   * exists, is not archived (unless `archived` is expected), and only a General Manager changes
   * a General Manager (F01 rules 5 and 12).
   */
  private async loadForChange(
    tx: Transaction,
    actor: CurrentUserInfo,
    id: string,
    options: { archived?: boolean } = {},
  ): Promise<LoadedUser> {
    await lockAccessChanges(tx);
    const [locked] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, id))
      .for('update');
    const user = locked && (await this.load(tx, [id])).get(id);
    if (!user) throw new NotFoundException();
    if (user.roles.includes('general_manager') && !isGeneralManager(actor)) {
      throw this.generalManagerOnly();
    }
    if (user.status === 'archived' && !options.archived) {
      throw new CodedException(409, 'USER_ARCHIVED', 'Restore the user before changing them');
    }
    return user;
  }

  private async changeRoles(
    tx: Transaction,
    actor: CurrentUserInfo,
    current: LoadedUser,
    roles: AssignableRole[],
  ): Promise<void> {
    const added = roles.filter((role) => !current.roles.includes(role));
    const removed = current.roles.filter((role) => !roles.includes(role));
    if (added.length === 0 && removed.length === 0) return;
    // Separation of duties (F01 rule 7): nobody changes their own roles, and only a General
    // Manager grants or removes General Manager and Finance (money access, F13).
    if (current.id === actor.id) {
      throw new CodedException(403, 'CANNOT_CHANGE_OWN_ROLES', 'Another user changes your roles');
    }
    const touchesGuarded = [...added, ...removed].some(isGeneralManagerGranted);
    if (touchesGuarded && !isGeneralManager(actor)) throw this.generalManagerOnly();
    if (removed.includes('general_manager') && current.status === 'active') {
      await this.assertAnotherActiveGeneralManager(tx, current.id);
    }
    for (const role of removed) {
      this.assertNoResponsibilities(await this.responsibilities.find(tx, current.id, role));
    }
    if (removed.length > 0) {
      await tx
        .delete(userRoles)
        .where(and(eq(userRoles.userId, current.id), inArray(userRoles.role, removed)));
    }
    if (added.length > 0) {
      await tx.insert(userRoles).values(added.map((role) => ({ userId: current.id, role })));
    }
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'user.roles_changed',
      entityType: 'user',
      entityId: current.id,
      before: { roles: current.roles },
      after: { roles: [...roles].sort() },
    });
    // F14 email rule 14; nobody changes their own roles (above).
    await this.emails.securityNotice(tx, current.id, 'roles_changed', actor.name);
  }

  /**
   * Applies a new primary and/or secondary set. Every user needs a primary department when their
   * profile is saved (F01 edge case 6), and keeps the departments they manage (rule 8).
   */
  private async changeDepartments(
    tx: Transaction,
    actor: CurrentUserInfo,
    current: LoadedUser,
    primaryInput: string | undefined,
    secondaryInput: string[] | undefined,
  ): Promise<void> {
    const currentPrimary = current.departments.find((d) => d.isPrimary)?.id;
    const primary = primaryInput ?? currentPrimary;
    if (!primary) {
      throw new CodedException(400, 'PRIMARY_DEPARTMENT_REQUIRED', 'Choose a primary department');
    }
    const secondary = (
      secondaryInput ?? current.departments.filter((d) => !d.isPrimary).map((d) => d.id)
    ).filter((id) => id !== primary);
    const wanted = [primary, ...secondary];
    const currentIds = current.departments.map((d) => d.id);
    const removed = current.departments.filter((d) => !wanted.includes(d.id));
    const added = wanted.filter((id) => !currentIds.includes(id));
    if (primary === currentPrimary && removed.length === 0 && added.length === 0) return;

    await this.assertDepartmentsActive(tx, added);
    const managed = removed.filter((d) => d.isManager);
    if (managed.length > 0) {
      throw new CodedException(
        409,
        'MANAGER_MEMBERSHIP_REQUIRED',
        'Change the manager of these departments first',
        managed.map((d) => ({ type: 'manages_department', id: d.id, name: d.name })),
      );
    }

    const before = await this.departmentsSnapshot(tx, current.id);
    if (removed.length > 0) {
      await tx.delete(departmentMembers).where(
        and(
          eq(departmentMembers.userId, current.id),
          inArray(
            departmentMembers.departmentId,
            removed.map((d) => d.id),
          ),
        ),
      );
    }
    // Clear the primary flag first: one primary per user is a unique index.
    await tx
      .update(departmentMembers)
      .set({ isPrimary: false })
      .where(
        and(eq(departmentMembers.userId, current.id), ne(departmentMembers.departmentId, primary)),
      );
    if (added.length > 0) {
      await tx
        .insert(departmentMembers)
        .values(
          added.map((departmentId) => ({ userId: current.id, departmentId, isPrimary: false })),
        );
    }
    await tx
      .update(departmentMembers)
      .set({ isPrimary: true })
      .where(
        and(eq(departmentMembers.userId, current.id), eq(departmentMembers.departmentId, primary)),
      );
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'user.departments_changed',
      entityType: 'user',
      entityId: current.id,
      before: { ...before },
      after: { ...(await this.departmentsSnapshot(tx, current.id)) },
    });
    if (removed.length > 0 || added.length > 0) {
      await this.notifyMoved(tx, actor, current, removed, added);
    }
  }

  /** F16 `member_moved`: the member and the managers of the departments they left and joined. */
  private async notifyMoved(
    tx: Transaction,
    actor: CurrentUserInfo,
    member: LoadedUser,
    removed: UserDepartment[],
    addedIds: string[],
  ): Promise<void> {
    const joined = await this.departmentsOf(tx, addedIds);
    const left = await this.departmentsOf(
      tx,
      removed.map((d) => d.id),
    );
    await this.notices.send(tx, [
      {
        type: 'member_moved',
        recipients: [
          member.id,
          ...[...left, ...joined].flatMap((d) => (d.managerId ? [d.managerId] : [])),
        ],
        actorId: actor.id,
        subjectId: member.id,
        data: {
          member: member.name,
          left: left.map((d) => d.code),
          joined: joined.map((d) => d.code),
        },
      },
    ]);
  }

  /**
   * F16 `member_archived_open_work`: the managers of the archived member's departments, else the
   * General Managers, about the open items that did not block archiving (F01 rule 9).
   */
  private async notifyOpenWork(
    tx: Transaction,
    actorId: string | null,
    member: LoadedUser,
    count: number,
  ): Promise<void> {
    const managers = (
      await this.departmentsOf(
        tx,
        member.departments.map((d) => d.id),
      )
    ).flatMap((d) => (d.managerId && d.managerId !== member.id ? [d.managerId] : []));
    await this.notices.send(tx, [
      {
        type: 'member_archived_open_work',
        recipients:
          managers.length > 0 ? managers : await this.directory.withRole('general_manager', tx),
        actorId,
        subjectId: member.id,
        data: { member: member.name, count },
      },
    ]);
  }

  private async departmentsOf(tx: Transaction, ids: string[]) {
    if (ids.length === 0) return [];
    return tx
      .select({ code: departments.code, managerId: departments.managerId })
      .from(departments)
      .where(inArray(departments.id, ids))
      .orderBy(asc(departments.name));
  }

  private async departmentsSnapshot(tx: Transaction, userId: string): Promise<DepartmentsSnapshot> {
    const rows = await tx
      .select({
        id: departments.id,
        name: departments.name,
        isPrimary: departmentMembers.isPrimary,
      })
      .from(departmentMembers)
      .innerJoin(departments, eq(departments.id, departmentMembers.departmentId))
      .where(eq(departmentMembers.userId, userId))
      .orderBy(asc(departments.name));
    const primary = rows.find((row) => row.isPrimary);
    return {
      primaryDepartment: primary ? { id: primary.id, name: primary.name } : null,
      secondaryDepartments: rows
        .filter((row) => !row.isPrimary)
        .map(({ id, name }) => ({ id, name })),
    };
  }

  private async issueLink(
    tx: Transaction,
    actor: CurrentUserInfo,
    userId: string,
    kind: 'activation' | 'reset',
    options: { restored?: boolean } = {},
  ) {
    const link = await this.links.issue(tx, userId, kind);
    // F14 email rule 13: the link is emailed too, and still returned once for copying.
    await this.emails.link(tx, userId, link, options);
    await recordAudit(tx, {
      actor: actorOf(actor),
      action: 'user.link_issued',
      entityType: 'user',
      entityId: userId,
      after: { kind },
    });
    return link;
  }

  /**
   * What blocks archiving a user (F01 rule 9): the departments they manage, plus what other
   * modules registered (F02 rule 8).
   */
  private async responsibilitiesOf(tx: Transaction, userId: string): Promise<Responsibility[]> {
    const managed = await tx
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(eq(departments.managerId, userId))
      .orderBy(asc(departments.name));
    return [
      ...managed.map((d) => ({ type: 'manages_department' as const, ...d })),
      ...(await this.responsibilities.find(tx, userId)),
    ];
  }

  private assertNoResponsibilities(responsibilities: Responsibility[]): void {
    if (responsibilities.length > 0) {
      throw new CodedException(
        409,
        'USER_HAS_RESPONSIBILITIES',
        'Move the user’s responsibilities to someone else first',
        responsibilities,
      );
    }
  }

  private async assertAnotherActiveGeneralManager(tx: Transaction, userId: string): Promise<void> {
    const [others] = await tx
      .select({ value: count() })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(userRoles.role, 'general_manager'),
          ne(users.id, userId),
          isNull(users.archivedAt),
          hasPassword,
        ),
      );
    if (!others?.value) {
      throw new CodedException(
        409,
        'LAST_GENERAL_MANAGER',
        'The last active General Manager must stay one',
      );
    }
  }

  /** Emails stay reserved while a user is archived (F01 rule 11). */
  private async assertEmailFree(tx: Transaction, email: string, exceptId?: string): Promise<void> {
    const [taken] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), exceptId ? ne(users.id, exceptId) : undefined));
    if (taken) throw new CodedException(409, 'EMAIL_TAKEN', 'Another user has this email');
  }

  /** The departments a user joins exist and are active (F23 rule 5). */
  private async assertDepartmentsActive(tx: Transaction, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const rows = await tx
      .select({ archivedAt: departments.archivedAt })
      .from(departments)
      .where(inArray(departments.id, ids));
    if (rows.length !== new Set(ids).size) {
      throw new CodedException(400, 'UNKNOWN_DEPARTMENT', 'A department does not exist');
    }
    if (rows.some((row) => row.archivedAt)) {
      throw new CodedException(409, 'DEPARTMENT_ARCHIVED', 'A department is archived');
    }
  }

  private generalManagerOnly() {
    return new CodedException(
      403,
      'GENERAL_MANAGER_ONLY',
      'Only a General Manager can change a General Manager or grant Finance',
    );
  }
}

/** The profile fields whose edit by someone else the user is told of (F01C rule 19). */
const PROFILE_FIELDS = ['name', 'title', 'phone', 'skills'] as const satisfies ProfileChange[];

/** Roles only a General Manager grants or removes (F01 rule 7). */
const isGeneralManagerGranted = (role: string) => role === 'general_manager' || role === 'finance';
