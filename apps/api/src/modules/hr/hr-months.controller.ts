import type { ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type AttendanceMonth,
  attendanceMonthSchema,
  type MonthSheet,
  type MonthSheetQuery,
  monthSheetQuerySchema,
  monthSheetSchema,
  type ReopenMonth,
  reopenMonthSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions, RequireSession } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceMonthsService } from './attendance-months.service.js';
import {
  employeeMonthWorkbook,
  monthWorkbook,
  sendWorkbook,
  XLSX_MIME_TYPE,
} from './attendance-workbooks.js';

/** F17 part D: the month sheet, closing and reopening a month, and its Excel files (D1–D5). */
@ApiTags('hr')
@Controller('hr')
export class HrMonthsController {
  constructor(
    private readonly months: AttendanceMonthsService,
    private readonly attendance: AttendanceService,
  ) {}

  @Get('months/:month')
  // `hr.read` or `salaries.read`, checked by the service.
  @RequireSession()
  @SerializeOptions({ schema: monthSheetSchema })
  @ApiOkResponse({
    description:
      "The month's days and totals of the employees in scope (`hr.read`; all for `salaries.read`), with pending counts",
    standardSchema: monthSheetSchema,
  })
  sheet(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('month') month: string,
    @Query({ schema: monthSheetQuerySchema }) query: MonthSheetQuery,
  ): Promise<MonthSheet> {
    return this.months.sheet(actor, month, query);
  }

  @Post('months/:month/close')
  @HttpCode(200)
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: attendanceMonthSchema })
  @ApiOkResponse({
    description:
      'Closes an ended month and writes its summaries. `MONTH_NOT_ENDED`, `MONTH_HAS_PENDING` (details: `pending`, `MonthPending[]`)',
    standardSchema: attendanceMonthSchema,
  })
  close(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('month') month: string,
  ): Promise<AttendanceMonth> {
    return this.months.close(actor, month);
  }

  @Post('months/:month/reopen')
  @HttpCode(200)
  @RequirePermissions('hr.approve')
  @SerializeOptions({ schema: attendanceMonthSchema })
  @ApiOkResponse({
    description: 'Reopens a closed month with a reason; its summaries stay. `NOT_CLOSED`',
    standardSchema: attendanceMonthSchema,
  })
  reopen(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('month') month: string,
    @Body({ schema: reopenMonthSchema }) input: ReopenMonth,
  ): Promise<AttendanceMonth> {
    return this.months.reopen(actor, month, input);
  }

  @Get('months/:month/export')
  @RequireSession()
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({ description: 'The month sheet as an Excel file: one row per employee' })
  async sheetExport(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('month') month: string,
    @Query({ schema: monthSheetQuerySchema }) query: MonthSheetQuery,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const sheet = await this.months.sheet(actor, month, query);
    sendWorkbook(response, `attendance-${month}.xlsx`, await monthWorkbook(sheet));
  }

  @Get('employees/:userId/months/:month/export')
  @RequireSession()
  @ApiProduces(XLSX_MIME_TYPE)
  @ApiOkResponse({
    description: "An employee's month as an Excel file, one row per day: one's own, or `hr.read`",
  })
  async employeeExport(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('month') month: string,
    @Res() response: ServerResponse,
  ): Promise<void> {
    // Checks the month first; the days check the scope.
    const items = await this.months.itemsOf(userId, month);
    const { items: days } = await this.attendance.month(actor, { userId, month });
    sendWorkbook(
      response,
      `attendance-${month}-${userId}.xlsx`,
      await employeeMonthWorkbook(days, items),
    );
  }
}
