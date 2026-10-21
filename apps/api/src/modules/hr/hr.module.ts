import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { EmployeeFileOwner } from './employee-file-owner.js';
import { EmployeeFiles } from './employee-files.js';
import { EmployeesService } from './employees.service.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { HolidaysService } from './holidays.service.js';
import { HrController } from './hr.controller.js';
import { HrDailyService } from './hr-daily.service.js';
import { HrRulesController } from './hr-rules.controller.js';
import { HrSettingsService } from './hr-settings.service.js';
import { SalaryChangesService } from './salary-changes.service.js';
import { WorkSchedulesService } from './work-schedules.service.js';

/**
 * HR (F17, ADR 0039), part A: the employee file of every user (kept in step with the account
 * through `UserLifecycle`), salary history, payout method, documents (F10 owner `employee`),
 * the end of service and the `hr.daily` job (contract and probation reminders, archiving ended
 * accounts through `AccountArchiver`). Reads users through `UserDirectory`. Part B: work
 * schedules, public holidays and the HR settings; exports `HolidayCalendar`, the holidays as
 * work-day input for `templates` and `content` (rule B1).
 */
@Module({
  imports: [AuthModule, FilesModule, NotificationsModule],
  controllers: [HrController, HrRulesController],
  providers: [
    EmployeeFiles,
    EmployeesService,
    SalaryChangesService,
    EmployeeFileOwner,
    HrDailyService,
    WorkSchedulesService,
    HolidaysService,
    HrSettingsService,
    HolidayCalendar,
  ],
  exports: [HolidayCalendar],
})
export class HrModule {}
