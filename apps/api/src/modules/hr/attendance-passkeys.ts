import { Injectable } from '@nestjs/common';
import { attendancePasskeys, type Database, type Transaction } from '@vertex-hub/db';
import { and, eq } from 'drizzle-orm';
import { type AuditActor, recordAudit } from '../audit/index.js';

type Executor = Database | Transaction;

export type PasskeyRow = typeof attendancePasskeys.$inferSelect;

/**
 * The attendance passkey rows (rules C3 and C9): one active and one pending per user at most.
 * Used by the passkey endpoints and by the decision on a `passkey_replacement` request.
 */
@Injectable()
export class AttendancePasskeys {
  async current(
    executor: Executor,
    userId: string,
    status: 'active' | 'pending',
  ): Promise<PasskeyRow | null> {
    const [row] = await executor
      .select()
      .from(attendancePasskeys)
      .where(and(eq(attendancePasskeys.userId, userId), eq(attendancePasskeys.status, status)));
    return row ?? null;
  }

  /** Rule C9: approving the replacement activates the pending passkey and revokes the old one. */
  async activatePending(tx: Transaction, userId: string, actor: AuditActor): Promise<void> {
    const pending = await this.current(tx, userId, 'pending');
    if (!pending) return;
    const now = new Date();
    const old = await this.current(tx, userId, 'active');
    if (old) {
      await tx
        .update(attendancePasskeys)
        .set({ status: 'revoked', decidedById: actor.id, decidedAt: now, archivedAt: now })
        .where(eq(attendancePasskeys.id, old.id));
      await recordAudit(tx, {
        actor,
        action: 'attendance_passkey.revoked',
        entityType: 'attendance_passkey',
        entityId: old.id,
        before: { status: 'active' },
        after: { status: 'revoked', replacedBy: pending.id },
      });
    }
    await tx
      .update(attendancePasskeys)
      .set({ status: 'active', decidedById: actor.id, decidedAt: now })
      .where(eq(attendancePasskeys.id, pending.id));
    await recordAudit(tx, {
      actor,
      action: 'attendance_passkey.activated',
      entityType: 'attendance_passkey',
      entityId: pending.id,
      before: { status: 'pending' },
      after: { status: 'active', userId },
    });
  }

  /** Revokes a passkey (a rejected or cancelled replacement, or `hr.approve`'s revocation). */
  async revoke(
    tx: Transaction,
    row: PasskeyRow,
    actor: AuditActor | null,
    note: string | null,
  ): Promise<PasskeyRow> {
    const now = new Date();
    const [revoked] = await tx
      .update(attendancePasskeys)
      .set({
        status: 'revoked',
        decidedById: actor?.id ?? null,
        decidedAt: now,
        decisionNote: note,
        archivedAt: now,
      })
      .where(eq(attendancePasskeys.id, row.id))
      .returning();
    await recordAudit(tx, {
      actor,
      action: 'attendance_passkey.revoked',
      entityType: 'attendance_passkey',
      entityId: row.id,
      before: { status: row.status },
      after: { status: 'revoked', userId: row.userId, ...(note && { note }) },
    });
    return revoked ?? row;
  }

  async revokePending(
    tx: Transaction,
    userId: string,
    actor: AuditActor | null,
    note: string | null,
  ): Promise<void> {
    const pending = await this.current(tx, userId, 'pending');
    if (pending) await this.revoke(tx, pending, actor, note);
  }
}
