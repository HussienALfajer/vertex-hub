import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AttendancePasskey,
  type AttendancePasskeyList,
  deviceOf,
  type RegisterPasskey,
  type RevokePasskey,
  type WebAuthnChallenge,
} from '@vertex-hub/contracts';
import { attendancePasskeys, type Database, employeeFiles, type Transaction } from '@vertex-hub/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import { type CurrentUserInfo, personRef, UserDirectory } from '../auth/index.js';
import { AttendancePasskeys, type PasskeyRow } from './attendance-passkeys.js';
import { AttendanceWebAuthn } from './attendance-webauthn.js';
import { HrRequestsService } from './hr-requests.service.js';
import { HrScope } from './hr-scope.js';
import { lockLeave } from './leave-ledger.js';

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const pendingExists = () =>
  new CodedException(409, 'PENDING_EXISTS', 'A new passkey is already waiting for approval');

/**
 * The attendance passkey endpoints (rules C3, C9, C10; edge cases 4–6): a user who is not exempt
 * registers one from their phone; the first is active at once, a later one waits for the General
 * Manager through a `passkey_replacement` request, even after a revocation. `hr.read` sees a person's passkeys; `hr.approve`
 * revokes one.
 */
@Injectable()
export class AttendancePasskeysService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UserDirectory,
    private readonly passkeys: AttendancePasskeys,
    private readonly webAuthn: AttendanceWebAuthn,
    private readonly requests: HrRequestsService,
    private readonly scope: HrScope,
  ) {}

  /** `POST /passkeys/options`. */
  async options(actor: CurrentUserInfo): Promise<WebAuthnChallenge> {
    await this.checkMayRegister(actor.id);
    const current = await this.db
      .select()
      .from(attendancePasskeys)
      .where(
        and(
          eq(attendancePasskeys.userId, actor.id),
          inArray(attendancePasskeys.status, ['active', 'pending']),
        ),
      );
    return this.webAuthn.registrationOptions(
      { id: actor.id, email: actor.email, name: actor.name },
      current.map((row) => ({
        credentialId: row.credentialId,
        publicKey: row.publicKey,
        counter: row.counter,
        transports: row.transports,
      })),
    );
  }

  /** `POST /passkeys`. */
  async register(
    actor: CurrentUserInfo,
    input: RegisterPasskey,
    userAgent: string | undefined,
  ): Promise<AttendancePasskey> {
    const ticket = this.webAuthn.open(input.ticket, 'register', actor.id);
    const credential = await this.webAuthn.verifyRegistration(ticket, input.response);
    const id = await this.db.transaction(async (tx) => {
      await lockLeave(tx, actor.id);
      await this.checkMayRegister(actor.id, tx);
      // Rule C9 and edge case 6: only the very first passkey is active at once; any later one,
      // after a revocation too, waits for the General Manager.
      const [earlier] = await tx
        .select({ id: attendancePasskeys.id })
        .from(attendancePasskeys)
        .where(eq(attendancePasskeys.userId, actor.id))
        .limit(1);
      const [row] = await tx
        .insert(attendancePasskeys)
        .values({
          userId: actor.id,
          credentialId: credential.credentialId,
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: credential.transports,
          deviceLabel: deviceOf(userAgent).label,
          status: earlier ? 'pending' : 'active',
        })
        .onConflictDoNothing()
        .returning();
      if (!row) throw pendingExists();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'attendance_passkey.registered',
        entityType: 'attendance_passkey',
        entityId: row.id,
        after: { status: row.status, deviceLabel: row.deviceLabel },
      });
      if (earlier) await this.requests.createPasskeyReplacement(tx, actor);
      return row.id;
    });
    return this.one(id);
  }

  /** `GET /passkeys/me`: one's own, newest first. */
  mine(actor: CurrentUserInfo): Promise<AttendancePasskeyList> {
    return this.listOf(actor.id);
  }

  /** `GET /passkeys?userId`: `hr.read` covering the user; empty outside the scope. */
  async list(actor: CurrentUserInfo, userId: string): Promise<AttendancePasskeyList> {
    if (userId !== actor.id && !(await this.scope.covers(actor, userId))) return { items: [] };
    return this.listOf(userId);
  }

  /** `POST /passkeys/:id/revoke` (`hr.approve`; edge case 6). */
  async revoke(
    actor: CurrentUserInfo,
    id: string,
    input: RevokePasskey,
  ): Promise<AttendancePasskey> {
    await this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ userId: attendancePasskeys.userId })
        .from(attendancePasskeys)
        .where(eq(attendancePasskeys.id, id));
      if (!owner) throw new NotFoundException();
      await lockLeave(tx, owner.userId);
      const [row] = await tx
        .select()
        .from(attendancePasskeys)
        .where(eq(attendancePasskeys.id, id))
        .for('update');
      if (!row || row.status === 'revoked') throw new NotFoundException();
      await this.passkeys.revoke(tx, row, actorOf(actor), input.note);
      if (row.status === 'pending') {
        await this.requests.cancelPasskeyReplacement(tx, row.userId, actor, input.note);
      }
    });
    return this.one(id);
  }

  /** Rule C2: attendance-exempt users have no passkey; edge case 6's pending one blocks another. */
  private async checkMayRegister(
    userId: string,
    executor: Database | Transaction = this.db,
  ): Promise<void> {
    const [file] = await executor
      .select({
        attendanceExempt: employeeFiles.attendanceExempt,
        archivedAt: employeeFiles.archivedAt,
      })
      .from(employeeFiles)
      .where(eq(employeeFiles.userId, userId));
    if (!file || file.attendanceExempt || file.archivedAt) {
      throw new CodedException(403, 'EXEMPT', 'Attendance does not apply to this account');
    }
    if (await this.passkeys.current(executor, userId, 'pending')) throw pendingExists();
  }

  private async listOf(userId: string): Promise<AttendancePasskeyList> {
    const rows = await this.db
      .select()
      .from(attendancePasskeys)
      .where(eq(attendancePasskeys.userId, userId))
      .orderBy(desc(attendancePasskeys.createdAt), desc(attendancePasskeys.id));
    return { items: await this.present(rows) };
  }

  private async one(id: string): Promise<AttendancePasskey> {
    const [row] = await this.db
      .select()
      .from(attendancePasskeys)
      .where(eq(attendancePasskeys.id, id));
    const [passkey] = row ? await this.present([row]) : [];
    if (!passkey) throw new NotFoundException();
    return passkey;
  }

  private async present(rows: readonly PasskeyRow[]): Promise<AttendancePasskey[]> {
    const people = await this.users.summaries(
      rows.flatMap((row) => [row.userId, ...(row.decidedById ? [row.decidedById] : [])]),
    );
    const person = (id: string) => personRef(people, id);
    return rows.map((row) => ({
      id: row.id,
      user: person(row.userId),
      deviceLabel: row.deviceLabel,
      status: row.status,
      decidedBy: row.decidedById ? person(row.decidedById) : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
