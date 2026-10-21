import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SHOOT_CHECK_IN_MINUTES_BEFORE } from '@vertex-hub/contracts';
import { shootCrew, shoots } from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { AttendanceShoots } from '../hr/index.js';

/**
 * F17 rule C13: the shoots a crew member checks in and out of, given to `hr`'s attendance. A shoot
 * opens for punches 30 minutes before its start and closes at its end.
 */
@Injectable()
export class AttendanceShootSource implements OnModuleInit {
  constructor(private readonly attendance: AttendanceShoots) {}

  onModuleInit(): void {
    this.attendance.register({
      punchable: (executor, userId, at) =>
        executor
          .select({
            id: shoots.id,
            title: shoots.title,
            startsAt: shoots.startsAt,
            endsAt: shoots.endsAt,
            location: shoots.location,
          })
          .from(shootCrew)
          .innerJoin(shoots, eq(shoots.id, shootCrew.shootId))
          .where(
            and(
              eq(shootCrew.userId, userId),
              eq(shoots.status, 'scheduled'),
              isNull(shoots.archivedAt),
              lte(shoots.startsAt, new Date(at.getTime() + SHOOT_CHECK_IN_MINUTES_BEFORE * 60_000)),
              gt(shoots.endsAt, at),
            ),
          )
          .orderBy(asc(shoots.startsAt), asc(shoots.id))
          .then((rows) =>
            rows.map((row) => ({
              ...row,
              startsAt: row.startsAt.toISOString(),
              endsAt: row.endsAt.toISOString(),
            })),
          ),
      places: async (executor, ids) => {
        const rows = await executor
          .select({
            id: shoots.id,
            title: shoots.title,
            location: shoots.location,
            mapUrl: shoots.mapUrl,
          })
          .from(shoots)
          .where(inArray(shoots.id, [...ids]));
        return new Map(rows.map((row) => [row.id, row]));
      },
    });
  }
}
