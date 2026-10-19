import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ACTIVITY_WINDOW_MS } from '@vertex-hub/contracts';
import { type Database, sessions } from '@vertex-hub/db';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DATABASE } from '../../core/database/database.module.js';
import { browserKeyOf } from './device-cookie.js';

/**
 * The client address in full: nginx overwrites `X-Forwarded-For` (edge case 6). Better Auth
 * keeps only the /64 prefix of an IPv6 address, which is right for its rate limits only.
 */
export function clientIpOf(
  forwardedFor: string | string[] | null | undefined,
  socketAddress?: string,
): string | null {
  const first = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
    ?.split(',')[0]
    ?.trim();
  const ip = first || socketAddress || '';
  return isIP(ip) ? ip : null;
}

/**
 * F01B rules 3 and 4: on each authenticated API request, records the session's last activity and
 * address at most once every 5 minutes, and gives a session without a browser key the key of the
 * request's `vh_device` cookie. This process remembers when it last wrote each session, so most
 * requests cost no query. A failed write is logged and never fails the request.
 */
@Injectable()
export class SessionActivity {
  private readonly logger = new Logger(SessionActivity.name);
  private readonly touched = new Map<string, number>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async touch(sessionId: string, headers: IncomingHttpHeaders, socketAddress?: string) {
    const now = Date.now();
    const last = this.touched.get(sessionId);
    if (last !== undefined && now - last < ACTIVITY_WINDOW_MS) return;
    if (this.touched.size > 10_000) this.forgetBefore(now - ACTIVITY_WINDOW_MS);

    const browserKey = browserKeyOf(headers.cookie);
    const stale = lt(
      sessions.lastActiveAt,
      sql`now() - ${`${ACTIVITY_WINDOW_MS} milliseconds`}::interval`,
    );
    try {
      const [written] = await this.db
        .update(sessions)
        .set({
          lastActiveAt: sql`now()`,
          lastIpAddress: clientIpOf(headers['x-forwarded-for'], socketAddress),
          ...(browserKey && { browserKey: sql`coalesce(${sessions.browserKey}, ${browserKey})` }),
        })
        .where(
          and(
            eq(sessions.id, sessionId),
            browserKey ? or(stale, isNull(sessions.browserKey)) : stale,
          ),
        )
        .returning({ lastActiveAt: sessions.lastActiveAt });
      // Remember when the stored activity was written, not when this request came: the next
      // write is due 5 minutes after it.
      const [stored] = written
        ? [written]
        : await this.db
            .select({ lastActiveAt: sessions.lastActiveAt })
            .from(sessions)
            .where(eq(sessions.id, sessionId));
      if (stored) this.touched.set(sessionId, stored.lastActiveAt.getTime());
    } catch (error) {
      this.logger.error(error, `Could not record the activity of session ${sessionId}`);
    }
  }

  private forgetBefore(since: number): void {
    for (const [id, at] of this.touched) if (at < since) this.touched.delete(id);
  }
}
