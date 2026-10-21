import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  SerializeOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateHoliday,
  type CreateWorkSchedule,
  createHolidaySchema,
  createWorkScheduleSchema,
  type Holiday,
  type HolidayList,
  type HolidayListQuery,
  type HrSettings,
  holidayListQuerySchema,
  holidayListSchema,
  holidaySchema,
  hrSettingsSchema,
  type RepeatHolidays,
  repeatHolidaysSchema,
  type UpdateHoliday,
  type UpdateWorkSchedule,
  updateHolidaySchema,
  updateWorkScheduleSchema,
  type WorkSchedule,
  type WorkScheduleList,
  workScheduleListSchema,
  workScheduleSchema,
} from '@vertex-hub/contracts';
import { RequirePermissions } from '../../core/access/index.js';
import { CurrentUser, type CurrentUserInfo } from '../auth/index.js';
import { HolidaysService } from './holidays.service.js';
import { HrSettingsService } from './hr-settings.service.js';
import { WorkSchedulesService } from './work-schedules.service.js';

/** F17 part B rules: work schedules (rule B2), public holidays (rule B3) and the HR settings. */
@ApiTags('hr')
@Controller('hr')
export class HrRulesController {
  constructor(
    private readonly schedules: WorkSchedulesService,
    private readonly holidays: HolidaysService,
    private readonly settings: HrSettingsService,
  ) {}

  @Get('schedules')
  @RequirePermissions('hr.read')
  @SerializeOptions({ schema: workScheduleListSchema })
  @ApiOkResponse({ description: 'The work schedules', standardSchema: workScheduleListSchema })
  listSchedules(): Promise<WorkScheduleList> {
    return this.schedules.list();
  }

  @Post('schedules')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: workScheduleSchema })
  @ApiCreatedResponse({ description: 'The new schedule', standardSchema: workScheduleSchema })
  createSchedule(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createWorkScheduleSchema }) input: CreateWorkSchedule,
  ): Promise<WorkSchedule> {
    return this.schedules.create(actor, input);
  }

  @Patch('schedules/:id')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: workScheduleSchema })
  @ApiOkResponse({
    description: 'The schedule after the change',
    standardSchema: workScheduleSchema,
  })
  updateSchedule(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateWorkScheduleSchema }) input: UpdateWorkSchedule,
  ): Promise<WorkSchedule> {
    return this.schedules.update(actor, id, input);
  }

  @Post('schedules/:id/archive')
  @HttpCode(200)
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: workScheduleSchema })
  @ApiOkResponse({
    description: 'The archived schedule; not the default, nor one with employees',
    standardSchema: workScheduleSchema,
  })
  archiveSchedule(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkSchedule> {
    return this.schedules.archive(actor, id);
  }

  @Get('holidays')
  @RequirePermissions('calendar.read')
  @SerializeOptions({ schema: holidayListSchema })
  @ApiOkResponse({ description: 'The holidays of a year', standardSchema: holidayListSchema })
  listHolidays(
    @Query({ schema: holidayListQuerySchema }) query: HolidayListQuery,
  ): Promise<HolidayList> {
    return this.holidays.list(query.year);
  }

  @Post('holidays')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: holidaySchema })
  @ApiCreatedResponse({ description: 'The new holiday', standardSchema: holidaySchema })
  createHoliday(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: createHolidaySchema }) input: CreateHoliday,
  ): Promise<Holiday> {
    return this.holidays.create(actor, input);
  }

  @Post('holidays/repeat')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: holidayListSchema })
  @ApiCreatedResponse({
    description: "Last year's holidays copied to the same dates, those that fit",
    standardSchema: holidayListSchema,
  })
  repeatHolidays(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: repeatHolidaysSchema }) input: RepeatHolidays,
  ): Promise<HolidayList> {
    return this.holidays.repeat(actor, input);
  }

  @Patch('holidays/:id')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: holidaySchema })
  @ApiOkResponse({ description: 'The holiday after the change', standardSchema: holidaySchema })
  updateHoliday(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateHolidaySchema }) input: UpdateHoliday,
  ): Promise<Holiday> {
    return this.holidays.update(actor, id, input);
  }

  @Post('holidays/:id/archive')
  @HttpCode(200)
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: holidaySchema })
  @ApiOkResponse({ description: 'The archived holiday', standardSchema: holidaySchema })
  archiveHoliday(
    @CurrentUser() actor: CurrentUserInfo,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Holiday> {
    return this.holidays.archive(actor, id);
  }

  @Get('settings')
  @RequirePermissions('hr.read')
  @SerializeOptions({ schema: hrSettingsSchema })
  @ApiOkResponse({ description: 'The HR settings', standardSchema: hrSettingsSchema })
  getSettings(): Promise<HrSettings> {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermissions('hr.manage')
  @SerializeOptions({ schema: hrSettingsSchema })
  @ApiOkResponse({
    description: 'The HR settings after the change',
    standardSchema: hrSettingsSchema,
  })
  updateSettings(
    @CurrentUser() actor: CurrentUserInfo,
    @Body({ schema: hrSettingsSchema }) input: HrSettings,
  ): Promise<HrSettings> {
    return this.settings.update(actor, input);
  }
}
