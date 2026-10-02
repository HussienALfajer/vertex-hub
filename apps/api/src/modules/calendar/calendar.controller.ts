import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type Calendar,
  type CalendarQuery,
  type ConflictList,
  type ConflictQuery,
  calendarQuerySchema,
  calendarSchema,
  conflictListSchema,
  conflictQuerySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { CalendarService } from './calendar.service.js';

@ApiTags('calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: calendarSchema })
  @ApiOkResponse({
    description:
      'Shoots and meetings overlapping the days (cancelled ones included, archived never) and the key dates of projects and retainers; at most 45 days; `shootType` narrows the shoots only',
    standardSchema: calendarSchema,
  })
  range(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: calendarQuerySchema }) query: CalendarQuery,
  ): Promise<Calendar> {
    return this.calendar.calendar(actor, query);
  }

  @Get('conflicts')
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: conflictListSchema })
  @ApiOkResponse({
    description:
      'The scheduled shoots and meetings of the users that overlap the time, by user then start',
    standardSchema: conflictListSchema,
  })
  conflicts(@Query({ schema: conflictQuerySchema }) query: ConflictQuery): Promise<ConflictList> {
    return this.calendar.conflictList(query);
  }
}
