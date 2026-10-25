import { createHmac } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type DeviceMatch,
  deviceMatch,
  deviceOf,
  type HardwareSignals,
  hardwareIdentity,
  type SharedDeviceUser,
  type SignedInDevice,
  type SignedInDeviceList,
  type SignOutAllDevicesResponse,
} from '@vertex-hub/contracts';
import { type Database, departmentMembers, departments, sessions, users } from '@vertex-hub/db';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/index.js';
import { recordAudit } from '../audit/index.js';
import { AccountEmails } from './account-emails.js';
import type { CurrentUserInfo } from './current-user.decorator.js';
import { DevicePushStates } from './device-push-states.js';
import { IpLocations } from './ip-locations.js';

const sessionColumns = {
  id: sessions.id,
  userId: sessions.userId,
  userAgent: sessions.userAgent,
  ipAddress: sessions.ipAddress,
  lastIpAddress: sessions.lastIpAddress,
  browserKey: sessions.browserKey,
  hardwareKey: sessions.hardwareKey,
  createdAt: sessions.createdAt,
  lastActiveAt: sessions.lastActiveAt,
};

/** Rule 15: the stronger match wins when a user shares the device in both ways. */
const STRENGTH: Record<DeviceMatch, number> = { same_browser: 2, same_device: 1 };

/** A session is open while its row exists and it has not expired. */
const open = () => gt(sessions.expiresAt, sql`now()`);

/**
 * F01B: the signed-in user's open sessions, the colleagues signed in on the same device, and
 * signing devices out. Every sign-out is audited and emailed in the transaction of the delete
 * (rule 12); Better Auth's own session endpoints are disabled (rule 13).
 */
@Injectable()
export class SignedInDevicesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly locations: IpLocations,
    private readonly emails: AccountEmails,
    private readonly push: DevicePushStates,
  ) {}

  /** Rules 14–16. */
  async list(actor: CurrentUserInfo): Promise<SignedInDeviceList> {
    const own = await this.db
      .select(sessionColumns)
      .from(sessions)
      .where(and(eq(sessions.userId, actor.id), open()));
    const browserKeys = own.flatMap((session) => session.browserKey ?? []);
    const hardwareKeys = own.flatMap((session) => session.hardwareKey ?? []);
    const others =
      browserKeys.length + hardwareKeys.length === 0
        ? []
        : await this.db
            .select({
              ...sessionColumns,
              name: users.name,
              imageId: users.imageId,
              departmentCode: departments.code,
              departmentName: departments.name,
            })
            .from(sessions)
            .innerJoin(users, eq(users.id, sessions.userId))
            .leftJoin(
              departmentMembers,
              and(eq(departmentMembers.userId, users.id), eq(departmentMembers.isPrimary, true)),
            )
            .leftJoin(departments, eq(departments.id, departmentMembers.departmentId))
            .where(
              and(
                ne(sessions.userId, actor.id),
                isNull(users.archivedAt),
                open(),
                or(
                  browserKeys.length ? inArray(sessions.browserKey, browserKeys) : undefined,
                  hardwareKeys.length ? inArray(sessions.hardwareKey, hardwareKeys) : undefined,
                ),
              ),
            );

    const pushOf = await this.push.of(own.map((session) => session.id));
    const items = own.map((session): SignedInDevice => {
      const shared = new Map<string, SharedDeviceUser>();
      for (const other of others) {
        const match = deviceMatch(session, other);
        if (!match) continue;
        const lastActiveAt = other.lastActiveAt.toISOString();
        const seen = shared.get(other.userId);
        if (seen) {
          if (STRENGTH[match] > STRENGTH[seen.match]) seen.match = match;
          if (lastActiveAt > seen.lastActiveAt) seen.lastActiveAt = lastActiveAt;
          continue;
        }
        shared.set(other.userId, {
          user: { id: other.userId, name: other.name, imageId: other.imageId },
          department:
            other.departmentCode && other.departmentName
              ? { code: other.departmentCode, name: other.departmentName }
              : null,
          match,
          lastActiveAt,
        });
      }
      const lastIp = session.lastIpAddress ?? session.ipAddress;
      return {
        id: session.id,
        current: session.id === actor.sessionId,
        device: deviceOf(session.userAgent),
        signIn: {
          at: session.createdAt.toISOString(),
          ip: session.ipAddress,
          location: this.locations.lookup(session.ipAddress),
        },
        lastActive: {
          at: session.lastActiveAt.toISOString(),
          ip: lastIp,
          location: this.locations.lookup(lastIp),
        },
        sharedWith: [...shared.values()].sort((a, b) => a.user.name.localeCompare(b.user.name)),
        push: pushOf(session.id),
      };
    });
    items.sort(
      (a, b) =>
        Number(b.current) - Number(a.current) || b.lastActive.at.localeCompare(a.lastActive.at),
    );
    return { items };
  }

  /**
   * Rule 5: keys the reported signals and stores the key on the current session. The first
   * report of a session stays (edge case 9); fewer than three known signals store nothing.
   */
  async reportHardware(actor: CurrentUserInfo, signals: HardwareSignals): Promise<void> {
    const sessionId = this.currentSession(actor);
    const [session] = await this.db
      .select({ userAgent: sessions.userAgent })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    const identity = hardwareIdentity(signals, session?.userAgent);
    if (!identity) return;
    const hardwareKey = createHmac('sha256', this.env.BETTER_AUTH_SECRET)
      .update(identity)
      .digest('hex');
    await this.db
      .update(sessions)
      .set({ hardwareKey })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.hardwareKey)));
  }

  /** Rules 9 and 12: signs out one of the user's other open sessions. */
  async signOut(actor: CurrentUserInfo, id: string): Promise<void> {
    if (id === this.currentSession(actor)) {
      throw new CodedException(400, 'CURRENT_SESSION', 'Sign out of this device instead');
    }
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, actor.id), open()))
        .returning({ userAgent: sessions.userAgent, ipAddress: sessions.ipAddress });
      // Another user's session, an expired one, or one signed out meanwhile (edge case 3).
      if (!removed) throw new NotFoundException();
      await recordAudit(tx, {
        actor,
        action: 'user.session_signed_out',
        entityType: 'user',
        entityId: actor.id,
        after: {
          device: deviceOf(removed.userAgent).label,
          ipAddress: removed.ipAddress,
          location: this.locations.lookup(removed.ipAddress),
        },
      });
      await this.emails.securityNotice(tx, actor.id, 'device_signed_out', null);
    });
  }

  /** Rules 10–12: signs out every open session of the user, with or without the current one. */
  async signOutAll(
    actor: CurrentUserInfo,
    includeCurrent: boolean,
  ): Promise<SignOutAllDevicesResponse> {
    const current = this.currentSession(actor);
    return this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(sessions)
        .where(
          and(
            eq(sessions.userId, actor.id),
            open(),
            includeCurrent ? undefined : ne(sessions.id, current),
          ),
        )
        .returning({ id: sessions.id });
      if (removed.length === 0) return { signedOut: 0 };
      await recordAudit(tx, {
        actor,
        action: 'user.sessions_signed_out',
        entityType: 'user',
        entityId: actor.id,
        after: { count: removed.length, includedCurrent: includeCurrent },
      });
      await this.emails.securityNotice(tx, actor.id, 'all_devices_signed_out', null);
      return { signedOut: removed.length };
    });
  }

  private currentSession(actor: CurrentUserInfo): string {
    if (!actor.sessionId) throw new Error('Signed-in devices need the session of the request');
    return actor.sessionId;
  }
}
