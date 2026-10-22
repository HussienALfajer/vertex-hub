import { Injectable, type OnModuleInit } from '@nestjs/common';
import { SHOOT_CHECK_IN_MINUTES_BEFORE } from '@vertex-hub/contracts';
import { shootCrew, shoots } from '@vertex-hub/db';
import { and, asc, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { AttendanceShoots, type CrewShoot } from '../hr/index.js';

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
      startingBetween: async (executor, from, to) => {
        const rows = await executor
          .select({
            id: shoots.id,
            title: shoots.title,
            startsAt: shoots.startsAt,
            endsAt: shoots.endsAt,
            location: shoots.location,
            userId: shootCrew.userId,
          })
          .from(shoots)
          .innerJoin(shootCrew, eq(shootCrew.shootId, shoots.id))
          .where(
            and(
              eq(shoots.status, 'scheduled'),
              isNull(shoots.archivedAt),
              gt(shoots.startsAt, from),
              lte(shoots.startsAt, to),
            ),
          )
          .orderBy(asc(shoots.startsAt), asc(shoots.id));
        const byId = new Map<string, CrewShoot>();
        for (const { userId, ...shoot } of rows) {
          const entry = byId.get(shoot.id) ?? { ...shoot, crewIds: [] };
          entry.crewIds.push(userId);
          byId.set(shoot.id, entry);
        }
        return [...byId.values()];
      },
      endingBetween: async (executor, from, to) => {
        const rows = await executor
          .select({ id: shoots.id })
          .from(shoots)
          .where(and(isNull(shoots.archivedAt), gt(shoots.endsAt, from), lte(shoots.endsAt, to)));
        return rows.map((row) => row.id);
      },
    });
  }
}
