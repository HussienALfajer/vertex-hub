import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type AttendanceKiosk,
  type AttendanceKioskList,
  type AttendanceKioskPairing,
  attendanceCodeMessage,
  attendanceCodeWindow,
  attendanceCodeWindowAccepted,
  type CreateAttendanceKiosk,
  KIOSK_LIMITS,
  OFFICE_NETWORK,
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  type PairedKiosk,
  parseAttendanceCode,
  sameOfficeNetwork,
} from '@vertex-hub/contracts';
import { attendanceKiosks, type Database, type KioskAddress } from '@vertex-hub/db';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { type AuditActor, recordAudit } from '../audit/index.js';
import type { CurrentUserInfo } from '../auth/index.js';
import { AttendanceWebAuthn } from './attendance-webauthn.js';

type KioskRow = typeof attendanceKiosks.$inferSelect;

const actorOf = (user: CurrentUserInfo): AuditActor => ({ id: user.id, name: user.name });

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const MINUTE = 60_000;

/** Why an office code was refused (rules C5 and C6). */
export type OfficeRefusal = 'INVALID_CODE' | 'OFF_OFFICE_NETWORK';

export class OfficeRefused extends CodedException {
  constructor(readonly reason: OfficeRefusal) {
    super(
      reason === 'INVALID_CODE' ? 409 : 403,
      reason,
      reason === 'INVALID_CODE'
        ? 'The entrance code is not valid now; scan again'
        : 'Connect to the office Wi-Fi',
    );
  }
}

/**
 * Entrance screens (rules C4–C6): created and unpaired by `hr.manage`, paired with a one-time
 * code that sets the screen's `vh_kiosk` cookie, then shown a code that changes every 20 seconds.
 * The secret that signs the codes never leaves the server.
 */
@Injectable()
export class AttendanceKiosksService {
  /** Decrypted secrets by kiosk id. */
  private readonly secrets = new Map<string, Buffer>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly webAuthn: AttendanceWebAuthn,
  ) {}

  async list(): Promise<AttendanceKioskList> {
    const rows = await this.db
      .select()
      .from(attendanceKiosks)
      .where(isNull(attendanceKiosks.archivedAt))
      .orderBy(desc(attendanceKiosks.createdAt), desc(attendanceKiosks.id));
    return { items: rows.map(toKiosk) };
  }

  async create(
    actor: CurrentUserInfo,
    input: CreateAttendanceKiosk,
  ): Promise<AttendanceKioskPairing> {
    const pairingCode = newPairingCode();
    const secret = await this.webAuthn.encryptSecret(randomBytes(32).toString('base64url'));
    const row = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(attendanceKiosks)
        .values({
          name: input.name,
          secret,
          pairingCodeHash: sha256(pairingCode),
          pairingExpiresAt: new Date(Date.now() + KIOSK_LIMITS.pairingMinutes * MINUTE),
          createdById: actor.id,
        })
        .returning();
      if (!created) throw new Error('Kiosk insert returned no row');
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'attendance_kiosk.created',
        entityType: 'attendance_kiosk',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    return { ...toKiosk(row), pairingCode };
  }

  /** A new pairing code; the screen's current cookie stops working. */
  async pairingCode(actor: CurrentUserInfo, id: string): Promise<AttendanceKioskPairing> {
    const pairingCode = newPairingCode();
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(attendanceKiosks)
        .set({
          tokenHash: null,
          pairingCodeHash: sha256(pairingCode),
          pairingExpiresAt: new Date(Date.now() + KIOSK_LIMITS.pairingMinutes * MINUTE),
        })
        .where(and(eq(attendanceKiosks.id, id), isNull(attendanceKiosks.archivedAt)))
        .returning();
      if (!updated) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'attendance_kiosk.pairing_started',
        entityType: 'attendance_kiosk',
        entityId: id,
        after: { pairingExpiresAt: updated.pairingExpiresAt?.toISOString() ?? null },
      });
      return updated;
    });
    return { ...toKiosk(row), pairingCode };
  }

  /** Rule C4: archiving unpairs the screen. */
  async archive(actor: CurrentUserInfo, id: string): Promise<AttendanceKiosk> {
    const row = await this.db.transaction(async (tx) => {
      const [archived] = await tx
        .update(attendanceKiosks)
        .set({
          archivedAt: new Date(),
          tokenHash: null,
          pairingCodeHash: null,
          pairingExpiresAt: null,
        })
        .where(and(eq(attendanceKiosks.id, id), isNull(attendanceKiosks.archivedAt)))
        .returning();
      if (!archived) throw new NotFoundException();
      await recordAudit(tx, {
        actor: actorOf(actor),
        action: 'attendance_kiosk.archived',
        entityType: 'attendance_kiosk',
        entityId: id,
        after: { name: archived.name },
      });
      return archived;
    });
    this.secrets.delete(id);
    return toKiosk(row);
  }

  /**
   * `POST /api/kiosk/pair`: a valid code pairs its screen and returns the cookie value, of which
   * only the hash is kept.
   */
  async pair(
    code: string,
    ipAddress: string | null,
  ): Promise<{ token: string; kiosk: PairedKiosk }> {
    const token = randomBytes(32).toString('base64url');
    const row = await this.db.transaction(async (tx) => {
      const [paired] = await tx
        .update(attendanceKiosks)
        .set({
          tokenHash: sha256(token),
          pairingCodeHash: null,
          pairingExpiresAt: null,
          lastSeenAt: new Date(),
          lastIpAddress: ipAddress,
          recentIps: ipAddress ? [{ address: ipAddress, at: new Date().toISOString() }] : [],
        })
        .where(
          and(
            eq(attendanceKiosks.pairingCodeHash, sha256(code)),
            gt(attendanceKiosks.pairingExpiresAt, new Date()),
            isNull(attendanceKiosks.archivedAt),
          ),
        )
        .returning();
      if (!paired) {
        throw new CodedException(400, 'INVALID_PAIRING_CODE', 'Unknown or expired pairing code');
      }
      await recordAudit(tx, {
        actor: null,
        actorName: paired.name,
        action: 'attendance_kiosk.paired',
        entityType: 'attendance_kiosk',
        entityId: paired.id,
        after: { ipAddress },
      });
      return paired;
    });
    return { token, kiosk: { id: row.id, name: row.name } };
  }

  /** The paired screen a `vh_kiosk` cookie names, or null. */
  async byToken(token: string | null): Promise<KioskRow | null> {
    if (!token) return null;
    const [row] = await this.db
      .select()
      .from(attendanceKiosks)
      .where(
        and(eq(attendanceKiosks.tokenHash, sha256(token)), isNull(attendanceKiosks.archivedAt)),
      );
    return row ?? null;
  }

  /** Rule C6: the screen was seen now from `ipAddress`; addresses older than 10 minutes drop. */
  async touch(kioskId: string, ipAddress: string | null, now = new Date()): Promise<void> {
    const [row] = await this.db
      .select({ recentIps: attendanceKiosks.recentIps })
      .from(attendanceKiosks)
      .where(eq(attendanceKiosks.id, kioskId));
    if (!row) return;
    const since = now.getTime() - OFFICE_NETWORK.addressMinutes * MINUTE;
    const recent: KioskAddress[] = row.recentIps.filter(
      (entry) => Date.parse(entry.at) >= since && entry.address !== ipAddress,
    );
    if (ipAddress) recent.push({ address: ipAddress, at: now.toISOString() });
    await this.db
      .update(attendanceKiosks)
      .set({ lastSeenAt: now, lastIpAddress: ipAddress, recentIps: recent })
      .where(and(eq(attendanceKiosks.id, kioskId), isNull(attendanceKiosks.archivedAt)));
  }

  /** Rule C5: the code a screen shows in a window. */
  async code(kiosk: Pick<KioskRow, 'id' | 'secret'>, window: number): Promise<string> {
    return `${attendanceCodeMessage(kiosk.id, window)}.${await this.mac(kiosk, window)}`;
  }

  /** Rule C5: the paired screen whose current code was scanned, or `INVALID_CODE`. */
  async verifyCode(scanned: string, now = new Date()): Promise<KioskRow> {
    const code = parseAttendanceCode(scanned);
    if (!code || !attendanceCodeWindowAccepted(code.window, attendanceCodeWindow(now))) {
      throw new OfficeRefused('INVALID_CODE');
    }
    const [kiosk] = await this.db
      .select()
      .from(attendanceKiosks)
      .where(eq(attendanceKiosks.id, code.kioskId));
    if (!kiosk || kiosk.archivedAt || !kiosk.tokenHash) throw new OfficeRefused('INVALID_CODE');
    const expected = Buffer.from(await this.mac(kiosk, code.window), 'base64url');
    const given = Buffer.from(code.mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new OfficeRefused('INVALID_CODE');
    }
    return kiosk;
  }

  /** Rule C6: the punch comes from the screen's network while the screen is online. */
  onOfficeNetwork(kiosk: KioskRow, ipAddress: string | null, now = new Date()): boolean {
    const seen = kiosk.lastSeenAt?.getTime() ?? 0;
    if (!ipAddress || now.getTime() - seen > OFFICE_NETWORK.screenSeenMinutes * MINUTE) {
      return false;
    }
    const since = now.getTime() - OFFICE_NETWORK.addressMinutes * MINUTE;
    return kiosk.recentIps.some(
      (entry) => Date.parse(entry.at) >= since && sameOfficeNetwork(entry.address, ipAddress),
    );
  }

  private async mac(kiosk: Pick<KioskRow, 'id' | 'secret'>, window: number): Promise<string> {
    let secret = this.secrets.get(kiosk.id);
    if (!secret) {
      secret = Buffer.from(await this.webAuthn.decryptSecret(kiosk.secret), 'base64url');
      this.secrets.set(kiosk.id, secret);
    }
    return createHmac('sha256', secret)
      .update(attendanceCodeMessage(kiosk.id, window))
      .digest()
      .subarray(0, 16)
      .toString('base64url');
  }
}

function newPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

function toKiosk(row: KioskRow): AttendanceKiosk {
  return {
    id: row.id,
    name: row.name,
    paired: !!row.tokenHash,
    pairingExpiresAt: row.pairingExpiresAt?.toISOString() ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastIpAddress: row.lastIpAddress,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}
