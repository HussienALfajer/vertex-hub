import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AttendanceDay,
  type AttendanceItem,
  type AttendanceItemDetail,
  type AttendanceItemListQuery,
  type AttendanceItemPage,
  attendanceDaySchema,
  attendanceItemDetailSchema,
  attendanceItemListQuerySchema,
  attendanceItemPageSchema,
  attendanceItemSchema,
  type DecideItem,
  decideItemSchema,
  type JustifyItem,
  justifyItemSchema,
  type RejectPunch,
  rejectPunchSchema,
  type TodayBoard,
  type TodayBoardQuery,
  todayBoardQuerySchema,
  todayBoardSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceItemsService } from './attendance-items.service.js';

/**
 * F17 part C decisions: attendance items and their justification and decision (rules C17, C18),
 * the review of field and shoot punches (rule C12) and the Today board.
 */
@ApiTags('hr')
@Controller('hr')
export class HrItemsController {
  constructor(
    private readonly items: AttendanceItemsService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('items')
  @RequireSession()
  @SerializeOptions({ schema: attendanceItemPageSchema })
  @ApiOkResponse({
    description: "Attendance items: one's own, and those `hr.read` covers",
    standardSchema: attendanceItemPageSchema,
  })
  list(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: attendanceItemListQuerySchema }) query: AttendanceItemListQuery,
  ): Promise<AttendanceItemPage> {
    return this.items.list(actor, query);
  }

  @Get('items/:id')
  @RequireSession()
  @SerializeOptions({ schema: attendanceItemDetailSchema })
  @ApiOkResponse({
    description: "An item with its day's timeline and opinions: one's own, or `hr.read` in scope",
    standardSchema: attendanceItemDetailSchema,
  })
  detail(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttendanceItemDetail> {
    return this.items.detail(actor, id);
  }

  @Post('items/:id/justification')
  @HttpCode(200)
  @RequireSession()
  @SerializeOptions({ schema: attendanceItemSchema })
  @ApiOkResponse({
    description: "The employee's reason on their pending item. `NOT_PENDING`",
    standardSchema: attendanceItemSchema,
  })
  justify(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: justifyItemSchema }) input: JustifyItem,
  ): Promise<AttendanceItem> {
    return this.items.justify(actor, id, input);
  }

  @Post('items/:id/decision')
  @HttpCode(200)
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: attendanceItemSchema })
  @ApiOkResponse({
    description: 'Decides an item, or changes its decision. `INVALID_DECISION`, `NOT_PENDING`',
    standardSchema: attendanceItemSchema,
  })
  decide(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: decideItemSchema }) input: DecideItem,
  ): Promise<AttendanceItem> {
    return this.items.decide(actor, id, input);
  }

  @Post('attendance/punches/:id/reject')
  @HttpCode(200)
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: attendanceDaySchema })
  @ApiOkResponse({
    description: 'Rejects a field or shoot punch; returns its recomputed day. `NOT_FIELD`',
    standardSchema: attendanceDaySchema,
  })
  rejectPunch(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: rejectPunchSchema }) input: RejectPunch,
  ): Promise<AttendanceDay> {
    return this.attendance.rejectPunch(actor, id, input);
  }

  @Get('attendance/today')
  @RequirePermissions('hr.read')
  @SerializeOptions({ schema: todayBoardSchema })
  @ApiOkResponse({
    description: "Where everyone in scope stands today, and today's refused office punches",
    standardSchema: todayBoardSchema,
  })
  today(
    @CurrentUser() actor: CurrentUserInfo,
    @Query({ schema: todayBoardQuerySchema }) query: TodayBoardQuery,
  ): Promise<TodayBoard> {
    return this.attendance.board(actor, query);
  }
}
