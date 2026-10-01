import { Controller, Get, Query, SerializeOptions } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type ConflictList,
  type ConflictQuery,
  conflictListSchema,
  conflictQuerySchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CalendarService } from './calendar.service.js';

@ApiTags('calendar')
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

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
