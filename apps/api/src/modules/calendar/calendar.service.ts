import { Injectable } from '@nestjs/common';
import type { ConflictList, ConflictQuery } from '@vertex-hub/contracts';
import { ScheduleConflicts } from './schedule-conflicts.js';

/** The company calendar's read model (spec F11 rule 15) and the live conflict check (rule 5). */
@Injectable()
export class CalendarService {
  constructor(private readonly conflicts: ScheduleConflicts) {}

  /** Rule 5 for a booking being edited; the shoot or meeting itself never conflicts. */
  async conflictList(query: ConflictQuery): Promise<ConflictList> {
    const items = await this.conflicts.of({
      kind: query.excludeMeetingId ? 'meeting' : 'shoot',
      id: query.excludeMeetingId ?? query.excludeShootId ?? null,
      startsAt: new Date(query.startsAt),
      endsAt: new Date(query.endsAt),
      userIds: query.userIds,
    });
    return { items };
  }
}
