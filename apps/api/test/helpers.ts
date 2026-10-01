import { createHmac, randomUUID } from 'node:crypto';
import type { AssignableRole, DepartmentCode } from '@vertex-hub/contracts';
import {
  accounts,
  approvalItems,
  approvalRequests,
  auditEntries,
  clientContacts,
  clientNotes,
  clientPlatformAccounts,
  clients,
  contentPosts,
  type Database,
  departmentMembers,
  departments,
  extraWorkItems,
  fileItems,
  fileUploads,
  fileVersions,
  meetingAttendees,
  meetingContacts,
  meetings,
  newId,
  notificationReminders,
  notificationSettings,
  notifications,
  postClientResponses,
  postReviews,
  projectMilestones,
  projects,
  retainerCycleAdjustments,
  retainerCycleLines,
  retainerCycles,
  retainerDeliverables,
  retainers,
  retainerTemplates,
  shootCrew,
  shootShots,
  shoots,
  taskChecklistItems,
  taskClientResponses,
  taskComments,
  taskDependencies,
  taskLinks,
  taskReviews,
  taskRevisions,
  tasks,
  templateRuns,
  templateRunTasks,
  userRoles,
  users,
  verifications,
  workTemplateAssignees,
  workTemplateStages,
  workTemplateStepDependencies,
  workTemplateSteps,
  workTemplates,
} from '@vertex-hub/db';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, inArray, isNotNull, like, or, type SQL } from 'drizzle-orm';

/*
 * Shared helpers for API integration tests: seed users straight into the test database, sign in
 * over HTTP (with the two-factor step), and clean up. Test data is unique per run (ADR 0013).
 */

/** Better Auth rejects cookie-carrying requests from origins it does not trust (CSRF). */
export const ORIGIN = 'http://127.0.0.1:5173';
export const PASSWORD = 'correct-horse-battery-staple';

export const uniqueEmail = (label: string) =>
  `${label}-${randomUUID().slice(0, 8)}@test.vertex.local`;

/**
 * A client address per call. Sign-in is rate limited per address (F01 rule 18), so each helper
 * call looks like a new client unless a test passes its own.
 */
export const clientIp = () =>
  `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;

export interface SeedUser {
  email?: string;
  name?: string;
  roles?: AssignableRole[];
  /** First entry is the primary department. Defaults to Design. */
  departments?: { code: DepartmentCode; manager?: boolean }[];
  /** `null` seeds an invited user (no password yet). */
  password?: string | null;
  archived?: boolean;
}

export interface SeededUser {
  id: string;
  email: string;
  name: string;
}

export async function departmentId(db: Database, code: DepartmentCode): Promise<string> {
  const [row] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.code, code));
  if (!row) throw new Error(`Department ${code} is not seeded`);
  return row.id;
}

export async function seedUser(db: Database, input: SeedUser = {}): Promise<SeededUser> {
  const id = newId();
  const email = input.email ?? uniqueEmail('user');
  const name = input.name ?? 'مستخدم اختبار';
  const password = input.password === undefined ? PASSWORD : input.password;
  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    archivedAt: input.archived ? new Date() : null,
  });
  if (password !== null) {
    await db.insert(accounts).values({
      userId: id,
      accountId: id,
      providerId: 'credential',
      password: await hashPassword(password),
    });
  }
  if (input.roles?.length) {
    await db.insert(userRoles).values(input.roles.map((role) => ({ userId: id, role })));
  }
  const memberships = input.departments ?? [{ code: 'design' }];
  for (const [index, membership] of memberships.entries()) {
    const deptId = await departmentId(db, membership.code);
    await db
      .insert(departmentMembers)
      .values({ userId: id, departmentId: deptId, isPrimary: index === 0 });
    if (membership.manager) {
      await db.update(departments).set({ managerId: id }).where(eq(departments.id, deptId));
    }
  }
  return { id, email, name };
}

/** Removes seeded users with everything that points at them (test cleanup only). */
export async function removeUsers(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const touched = await db
    .selectDistinct({ id: fileVersions.fileItemId })
    .from(fileVersions)
    .where(or(inArray(fileVersions.uploadedById, ids), inArray(fileVersions.finalMarkedById, ids)));
  await removeFileItems(
    db,
    or(
      inArray(fileItems.createdById, ids),
      inArray(
        fileItems.id,
        touched.map((row) => row.id),
      ),
    ) as SQL,
  );
  await db.delete(fileUploads).where(inArray(fileUploads.userId, ids));
  await removeShoots(
    db,
    [
      ...(await db
        .select({ id: shoots.id })
        .from(shoots)
        .where(or(inArray(shoots.createdById, ids), inArray(shoots.completedById, ids)))),
      ...(await db
        .select({ id: shootCrew.shootId })
        .from(shootCrew)
        .where(inArray(shootCrew.userId, ids))),
      ...(await db
        .select({ id: shootShots.shootId })
        .from(shootShots)
        .where(inArray(shootShots.doneById, ids))),
    ].map((row) => row.id),
  );
  await removeMeetings(
    db,
    [
      ...(await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(or(inArray(meetings.organizerId, ids), inArray(meetings.createdById, ids)))),
      ...(await db
        .select({ id: meetingAttendees.meetingId })
        .from(meetingAttendees)
        .where(inArray(meetingAttendees.userId, ids))),
    ].map((row) => row.id),
  );
  await removeTasks(
    db,
    (
      await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(or(inArray(tasks.createdById, ids), inArray(tasks.assigneeId, ids)))
    ).map((row) => row.id),
  );
  await removePosts(
    db,
    (
      await db
        .select({ id: contentPosts.id })
        .from(contentPosts)
        .where(or(inArray(contentPosts.createdById, ids), inArray(contentPosts.responsibleId, ids)))
    ).map((row) => row.id),
  );
  const comments = (
    await db
      .select({ id: taskComments.id })
      .from(taskComments)
      .where(inArray(taskComments.authorId, ids))
  ).map((row) => row.id);
  if (comments.length > 0) {
    await db.delete(auditEntries).where(inArray(auditEntries.entityId, comments));
    await db.delete(taskComments).where(inArray(taskComments.id, comments));
  }
  await db
    .delete(auditEntries)
    .where(or(inArray(auditEntries.actorId, ids), inArray(auditEntries.entityId, ids)));
  await db
    .delete(notifications)
    .where(or(inArray(notifications.recipientId, ids), inArray(notifications.actorId, ids)));
  await db.delete(notificationSettings).where(inArray(notificationSettings.userId, ids));
  // Activation and reset links keep the user id as their value.
  await db.delete(verifications).where(inArray(verifications.value, ids));
  await db.update(departments).set({ managerId: null }).where(inArray(departments.managerId, ids));
  await db.delete(users).where(inArray(users.id, ids));
}

/** Removes shoots with their crew, shots, notifications and audit entries (test cleanup only). */
export async function removeShoots(db: Database, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, unique));
  await db.delete(notifications).where(inArray(notifications.subjectId, unique));
  await db.delete(notificationReminders).where(inArray(notificationReminders.subjectId, unique));
  await db.delete(shootShots).where(inArray(shootShots.shootId, unique));
  await db.delete(shootCrew).where(inArray(shootCrew.shootId, unique));
  await db.delete(shoots).where(inArray(shoots.id, unique));
}

/** Removes meetings with their attendees, contacts, notifications and audit entries. */
export async function removeMeetings(db: Database, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, unique));
  await db.delete(notifications).where(inArray(notifications.subjectId, unique));
  await db.delete(notificationReminders).where(inArray(notificationReminders.subjectId, unique));
  await db.delete(meetingAttendees).where(inArray(meetingAttendees.meetingId, unique));
  await db.delete(meetingContacts).where(inArray(meetingContacts.meetingId, unique));
  await db.delete(meetings).where(inArray(meetings.id, unique));
}

/** The domain of every seeded user's email (`uniqueEmail`). */
export const TEST_EMAIL_DOMAIN = '@test.vertex.local';

/**
 * Removes users an interrupted earlier run left behind, so the next run starts from a clean
 * database: daily-job and directory tests read every row (ADR 0013, test data per run).
 */
export async function removeLeftoverUsers(db: Database): Promise<number> {
  const leftovers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `%${TEST_EMAIL_DOMAIN}`));
  await removeUsers(
    db,
    leftovers.map((row) => row.id),
  );
  return leftovers.length;
}

/**
 * Removes seeded clients, their contacts, accounts, notes, projects and audit entries (test
 * cleanup only).
 */
export async function removeClients(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await removeFileItems(db, inArray(fileItems.clientId, ids));
  await removeShoots(
    db,
    (await db.select({ id: shoots.id }).from(shoots).where(inArray(shoots.clientId, ids))).map(
      (row) => row.id,
    ),
  );
  const contactIds = (
    await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(inArray(clientContacts.clientId, ids))
  ).map((row) => row.id);
  await removeMeetings(
    db,
    [
      ...(await db
        .select({ id: meetings.id })
        .from(meetings)
        .where(inArray(meetings.clientId, ids))),
      ...(contactIds.length > 0
        ? await db
            .select({ id: meetingContacts.meetingId })
            .from(meetingContacts)
            .where(inArray(meetingContacts.contactId, contactIds))
        : []),
    ].map((row) => row.id),
  );
  await removeTasks(
    db,
    (await db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.clientId, ids))).map(
      (row) => row.id,
    ),
  );
  await removePosts(
    db,
    (
      await db
        .select({ id: contentPosts.id })
        .from(contentPosts)
        .where(inArray(contentPosts.clientId, ids))
    ).map((row) => row.id),
  );
  const clientProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(inArray(projects.clientId, ids));
  await removeProjects(
    db,
    clientProjects.map((row) => row.id),
  );
  const clientRetainers = await db
    .select({ id: retainers.id })
    .from(retainers)
    .where(inArray(retainers.clientId, ids));
  await removeRetainers(
    db,
    clientRetainers.map((row) => row.id),
  );
  const children = [
    ...(await db
      .select({ id: clientContacts.id })
      .from(clientContacts)
      .where(inArray(clientContacts.clientId, ids))),
    ...(await db
      .select({ id: clientPlatformAccounts.id })
      .from(clientPlatformAccounts)
      .where(inArray(clientPlatformAccounts.clientId, ids))),
    ...(await db
      .select({ id: clientNotes.id })
      .from(clientNotes)
      .where(inArray(clientNotes.clientId, ids))),
  ].map((row) => row.id);
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, [...ids, ...children]));
  await db.delete(clientNotes).where(inArray(clientNotes.clientId, ids));
  await db.delete(clientContacts).where(inArray(clientContacts.clientId, ids));
  await db.delete(clientPlatformAccounts).where(inArray(clientPlatformAccounts.clientId, ids));
  await db.delete(clients).where(inArray(clients.id, ids));
}

/**
 * Removes seeded tasks with their dependencies (both ways), checklists, links, revisions,
 * comments and audit entries (test cleanup only).
 */
export async function removeTasks(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await removeShoots(
    db,
    (
      await db
        .select({ id: shoots.id })
        .from(shoots)
        .where(or(inArray(shoots.taskId, ids), inArray(shoots.editingTaskId, ids)))
    ).map((row) => row.id),
  );
  await removeFileItems(db, inArray(fileItems.taskId, ids));
  const children = [
    ...(await db
      .select({ id: taskChecklistItems.id })
      .from(taskChecklistItems)
      .where(inArray(taskChecklistItems.taskId, ids))),
    ...(await db
      .select({ id: taskLinks.id })
      .from(taskLinks)
      .where(inArray(taskLinks.taskId, ids))),
    ...(await db
      .select({ id: taskComments.id })
      .from(taskComments)
      .where(inArray(taskComments.taskId, ids))),
  ].map((row) => row.id);
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, [...ids, ...children]));
  await db.delete(templateRunTasks).where(inArray(templateRunTasks.taskId, ids));
  await db
    .delete(taskDependencies)
    .where(or(inArray(taskDependencies.taskId, ids), inArray(taskDependencies.dependsOnId, ids)));
  await db.delete(taskChecklistItems).where(inArray(taskChecklistItems.taskId, ids));
  await db.delete(taskLinks).where(inArray(taskLinks.taskId, ids));
  await db.delete(taskComments).where(inArray(taskComments.taskId, ids));
  // F09: responses and reviews point at revisions, and tasks at their cleared review.
  await db.update(tasks).set({ clearedReviewId: null }).where(inArray(tasks.id, ids));
  await removeRequests(db, inArray(approvalItems.taskId, ids));
  await db.delete(taskClientResponses).where(inArray(taskClientResponses.taskId, ids));
  await db.delete(taskReviews).where(inArray(taskReviews.taskId, ids));
  await db.delete(taskRevisions).where(inArray(taskRevisions.taskId, ids));
  await db.delete(notificationReminders).where(inArray(notificationReminders.subjectId, ids));
  await db.delete(tasks).where(inArray(tasks.id, ids));
}

/**
 * Removes the approval requests holding the given items, whole: their items, the responses those
 * items recorded on tasks and posts, their notifications and audit entries (test cleanup only).
 */
async function removeRequests(db: Database, itemFilter: SQL): Promise<void> {
  const requests = (
    await db.selectDistinct({ id: approvalItems.requestId }).from(approvalItems).where(itemFilter)
  ).map((row) => row.id);
  if (requests.length === 0) return;
  const inRequests = inArray(approvalItems.requestId, requests);
  const items = (
    await db.select({ id: approvalItems.id }).from(approvalItems).where(inRequests)
  ).map((row) => row.id);
  // Approval items and responses point at each other: the items let go first, as withdrawn.
  await db
    .update(approvalItems)
    .set({
      status: 'withdrawn',
      withdrawnReason: 'revoked',
      responseId: null,
      postResponseId: null,
    })
    .where(
      and(
        inRequests,
        or(isNotNull(approvalItems.responseId), isNotNull(approvalItems.postResponseId)),
      ),
    );
  await db.delete(taskClientResponses).where(inArray(taskClientResponses.approvalItemId, items));
  await removePostResponses(db, inArray(postClientResponses.approvalItemId, items));
  await db.delete(approvalItems).where(inRequests);
  await db.delete(notifications).where(inArray(notifications.subjectId, requests));
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, requests));
  await db.delete(approvalRequests).where(inArray(approvalRequests.id, requests));
}

/** Removes client responses on posts; the task revisions they caused let go of them first. */
async function removePostResponses(db: Database, filter: SQL): Promise<void> {
  const responses = (
    await db.select({ id: postClientResponses.id }).from(postClientResponses).where(filter)
  ).map((row) => row.id);
  if (responses.length === 0) return;
  await db
    .update(taskRevisions)
    .set({ postResponseId: null })
    .where(inArray(taskRevisions.postResponseId, responses));
  await db.delete(postClientResponses).where(inArray(postClientResponses.id, responses));
}

/**
 * Removes seeded posts with their files, reviews, client responses, approval requests,
 * reminders, notifications and audit entries, and unlinks their tasks (test cleanup only).
 */
export async function removePosts(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await removeFileItems(db, inArray(fileItems.postId, ids));
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
  await db
    .update(tasks)
    .set({ postId: null, postLinkedAt: null })
    .where(inArray(tasks.postId, ids));
  // Posts point at their cleared review, and responses at reviews.
  await db.update(contentPosts).set({ clearedReviewId: null }).where(inArray(contentPosts.id, ids));
  await removeRequests(db, inArray(approvalItems.postId, ids));
  await removePostResponses(db, inArray(postClientResponses.postId, ids));
  await db.delete(postReviews).where(inArray(postReviews.postId, ids));
  await db.delete(notificationReminders).where(inArray(notificationReminders.subjectId, ids));
  await db.delete(notifications).where(inArray(notifications.subjectId, ids));
  await db.delete(contentPosts).where(inArray(contentPosts.id, ids));
}

/** Removes file items with their versions and audit entries; content stays on disk (test cleanup only). */
async function removeFileItems(db: Database, filter: SQL): Promise<void> {
  const items = (await db.select({ id: fileItems.id }).from(fileItems).where(filter)).map(
    (row) => row.id,
  );
  if (items.length === 0) return;
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, items));
  await db.delete(fileVersions).where(inArray(fileVersions.fileItemId, items));
  await db.delete(fileItems).where(inArray(fileItems.id, items));
}

/** Removes template runs with their task links and audit entries (test cleanup only). */
async function removeRuns(db: Database, runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, runIds));
  await db.delete(templateRunTasks).where(inArray(templateRunTasks.runId, runIds));
  await db.delete(templateRuns).where(inArray(templateRuns.id, runIds));
}

/** Removes seeded projects, their milestones, template runs and audit entries (test cleanup only). */
export async function removeProjects(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await removeFileItems(db, inArray(fileItems.projectId, ids));
  await removeRuns(
    db,
    (
      await db
        .select({ id: templateRuns.id })
        .from(templateRuns)
        .where(inArray(templateRuns.projectId, ids))
    ).map((row) => row.id),
  );
  const milestones = (
    await db
      .select({ id: projectMilestones.id })
      .from(projectMilestones)
      .where(inArray(projectMilestones.projectId, ids))
  ).map((row) => row.id);
  const extraWork = (
    await db
      .select({ id: extraWorkItems.id })
      .from(extraWorkItems)
      .where(inArray(extraWorkItems.projectId, ids))
  ).map((row) => row.id);
  await db
    .delete(auditEntries)
    .where(inArray(auditEntries.entityId, [...ids, ...milestones, ...extraWork]));
  await db.delete(extraWorkItems).where(inArray(extraWorkItems.projectId, ids));
  await db.delete(projectMilestones).where(inArray(projectMilestones.projectId, ids));
  await db.delete(projects).where(inArray(projects.id, ids));
}

/**
 * Removes seeded retainers, their lines, cycles, template link and runs, extra work and audit
 * entries (test cleanup only).
 */
export async function removeRetainers(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await removeFileItems(db, inArray(fileItems.retainerId, ids));
  await db.delete(notificationReminders).where(inArray(notificationReminders.subjectId, ids));
  const cycles = (
    await db
      .select({ id: retainerCycles.id })
      .from(retainerCycles)
      .where(inArray(retainerCycles.retainerId, ids))
  ).map((row) => row.id);
  if (cycles.length) {
    await removeRuns(
      db,
      (
        await db
          .select({ id: templateRuns.id })
          .from(templateRuns)
          .where(inArray(templateRuns.retainerCycleId, cycles))
      ).map((row) => row.id),
    );
  }
  await db.delete(retainerTemplates).where(inArray(retainerTemplates.retainerId, ids));
  const lines = cycles.length
    ? (
        await db
          .select({ id: retainerCycleLines.id })
          .from(retainerCycleLines)
          .where(inArray(retainerCycleLines.cycleId, cycles))
      ).map((row) => row.id)
    : [];
  const extraWork = (
    await db
      .select({ id: extraWorkItems.id })
      .from(extraWorkItems)
      .where(inArray(extraWorkItems.retainerId, ids))
  ).map((row) => row.id);
  await db
    .delete(auditEntries)
    .where(inArray(auditEntries.entityId, [...ids, ...cycles, ...extraWork]));
  if (lines.length) {
    await db
      .delete(retainerCycleAdjustments)
      .where(inArray(retainerCycleAdjustments.lineId, lines));
    await db.delete(retainerCycleLines).where(inArray(retainerCycleLines.id, lines));
  }
  if (cycles.length) await db.delete(retainerCycles).where(inArray(retainerCycles.id, cycles));
  await db.delete(extraWorkItems).where(inArray(extraWorkItems.retainerId, ids));
  await db.delete(retainerDeliverables).where(inArray(retainerDeliverables.retainerId, ids));
  await db.delete(retainers).where(inArray(retainers.id, ids));
}

/**
 * Removes seeded templates with their stages, steps, default assignees, retainer links, runs and
 * audit entries; the generated tasks go with their clients (test cleanup only).
 */
export async function removeTemplates(db: Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const runs = (
    await db
      .select({ id: templateRuns.id })
      .from(templateRuns)
      .where(inArray(templateRuns.templateId, ids))
  ).map((row) => row.id);
  const steps = (
    await db
      .select({ id: workTemplateSteps.id })
      .from(workTemplateSteps)
      .where(inArray(workTemplateSteps.templateId, ids))
  ).map((row) => row.id);
  await db.delete(auditEntries).where(inArray(auditEntries.entityId, ids));
  await removeRuns(db, runs);
  await db.delete(retainerTemplates).where(inArray(retainerTemplates.templateId, ids));
  if (steps.length) {
    await db
      .delete(workTemplateStepDependencies)
      .where(inArray(workTemplateStepDependencies.stepId, steps));
  }
  await db.delete(workTemplateSteps).where(inArray(workTemplateSteps.templateId, ids));
  await db.delete(workTemplateStages).where(inArray(workTemplateStages.templateId, ids));
  await db.delete(workTemplateAssignees).where(inArray(workTemplateAssignees.templateId, ids));
  await db.delete(workTemplates).where(inArray(workTemplates.id, ids));
}

function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of input.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** The current 6-digit TOTP code (RFC 6238, SHA-1, 30 s) for a base32 secret. */
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac.at(-1) ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

export const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

export function api(url: string) {
  const request = (
    method: string,
    path: string,
    options: { cookie?: string; body?: unknown; ip?: string } = {},
  ) =>
    fetch(`${url}${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        'x-forwarded-for': options.ip ?? clientIp(),
        ...(options.cookie && { cookie: options.cookie }),
        ...(options.body !== undefined && { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

  /** Signs in with email and password, and with a TOTP code when the user has 2FA on. */
  async function signIn(
    email: string,
    options: { password?: string; totpSecret?: string; ip?: string } = {},
  ): Promise<string> {
    const ip = options.ip ?? clientIp();
    const response = await request('POST', '/api/auth/sign-in/email', {
      body: { email, password: options.password ?? PASSWORD },
      ip,
    });
    if (response.status !== 200) throw new Error(`Sign-in failed: ${response.status}`);
    const body = (await response.json()) as { twoFactorRedirect?: boolean };
    if (!body.twoFactorRedirect) return cookieHeader(response);
    if (!options.totpSecret) throw new Error('Sign-in needs a TOTP secret');
    const verified = await request('POST', '/api/auth/two-factor/verify-totp', {
      cookie: cookieHeader(response),
      body: { code: totp(options.totpSecret) },
      ip,
    });
    if (verified.status !== 200) throw new Error(`2FA verification failed: ${verified.status}`);
    return cookieHeader(verified);
  }

  /**
   * Turns on two-factor sign-in through Better Auth for a signed-in user, the way the setup page
   * does. Better Auth replaces the session when 2FA turns on: use the returned cookie.
   */
  async function enableTwoFactor(
    cookie: string,
    password = PASSWORD,
  ): Promise<{ secret: string; backupCodes: string[]; cookie: string }> {
    const ip = clientIp();
    const enabled = await request('POST', '/api/auth/two-factor/enable', {
      cookie,
      body: { password },
      ip,
    });
    if (enabled.status !== 200) throw new Error(`2FA enable failed: ${enabled.status}`);
    const { totpURI, backupCodes } = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const secret = new URL(totpURI).searchParams.get('secret') ?? '';
    const verified = await request('POST', '/api/auth/two-factor/verify-totp', {
      cookie,
      body: { code: totp(secret) },
      ip,
    });
    if (verified.status !== 200) throw new Error(`2FA verification failed: ${verified.status}`);
    return { secret, backupCodes, cookie: cookieHeader(verified) || cookie };
  }

  /** Seeds a user who must use 2FA, enables it, and returns them signed in. */
  async function signInWithTwoFactor(db: Database, input: SeedUser) {
    const user = await seedUser(db, input);
    const { secret, backupCodes } = await enableTwoFactor(await signIn(user.email));
    const cookie = await signIn(user.email, { totpSecret: secret });
    return { ...user, cookie, secret, backupCodes };
  }

  return {
    get: (path: string, cookie?: string) => request('GET', path, { cookie }),
    post: (path: string, cookie?: string, body?: unknown) =>
      request('POST', path, { cookie, body: body ?? {} }),
    request,
    signIn,
    enableTwoFactor,
    signInWithTwoFactor,
  };
}
