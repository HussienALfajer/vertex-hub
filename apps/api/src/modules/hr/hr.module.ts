import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/index.js';
import { AuthModule } from '../auth/index.js';
import { FilesModule } from '../files/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { AttendanceService } from './attendance.service.js';
import { AttendanceDays } from './attendance-days.js';
import { AttendanceFieldWork } from './attendance-field-work.js';
import { AttendanceItems } from './attendance-items.js';
import { AttendanceItemsService } from './attendance-items.service.js';
import { AttendanceKiosksService } from './attendance-kiosks.service.js';
import { AttendancePasskeys } from './attendance-passkeys.js';
import { AttendancePasskeysService } from './attendance-passkeys.service.js';
import { AttendanceReminders } from './attendance-reminders.js';
import { AttendanceShoots } from './attendance-shoots.js';
import { AttendanceWebAuthn } from './attendance-webauthn.js';
import { EmployeeFileOwner } from './employee-file-owner.js';
import { EmployeeFiles } from './employee-files.js';
import { EmployeesService } from './employees.service.js';
import { HolidayCalendar } from './holiday-calendar.js';
import { HolidaysService } from './holidays.service.js';
import { HrController } from './hr.controller.js';
import { HrAttendanceController } from './hr-attendance.controller.js';
import { HrDailyService } from './hr-daily.service.js';
import { HrItemsController } from './hr-items.controller.js';
import { HrLeaveController } from './hr-leave.controller.js';
import { HrRequestFileOwner } from './hr-request-file-owner.js';
import { HrRequestsService } from './hr-requests.service.js';
import { HrRulesController } from './hr-rules.controller.js';
import { HrScope } from './hr-scope.js';
import { HrSettingsService } from './hr-settings.service.js';
import { KioskController } from './kiosk.controller.js';
import { KioskStream } from './kiosk-stream.js';
import { LeaveBalancesService } from './leave-balances.service.js';
import { LeaveContext } from './leave-context.js';
import { LeaveDirectory } from './leave-directory.js';
import { LeaveJobs } from './leave-jobs.js';
import { LeaveLedger } from './leave-ledger.js';
import { LeaveWorkSources } from './leave-work-sources.js';
import { SalaryChangesService } from './salary-changes.service.js';
import { WorkSchedulesService } from './work-schedules.service.js';

/**
 * HR (F17, ADR 0039), part A: the employee file of every user (kept in step with the account
 * through `UserLifecycle`), salary history, payout method, documents (F10 owner `employee`),
 * the end of service and the `hr.daily` job (contract and probation reminders, archiving ended
 * accounts through `AccountArchiver`). Reads users through `UserDirectory`. Part B: work
 * schedules, public holidays and the HR settings; exports `HolidayCalendar`, the holidays as
 * work-day input for `templates` and `content` (rule B1); leave and permission requests, the
 * balance ledger and its daily steps (rules B4–B18). Exports `LeaveDirectory` (approved leave for
 * the `calendar` and `tasks` modules, rules B16 and B17) and the `LeaveWorkSources` registry they
 * fill with an employee's work (rule B14), so `hr` imports neither. Registers the `hr_request`
 * owner policy in `files` (rule B13). Part C: attendance passkeys (WebAuthn, ADR 0039), entrance
 * screens and their stream, punches and the days computed from them (rules C1–C16, C20); exports
 * the `AttendanceShoots` registry `calendar` fills for shoot check-ins (rule C13), and the
 * `AttendanceFieldWork` registry `tasks` and `calendar` fill with titles (rule C11). Attendance
 * items, their justification and decision, remote days and corrections, field punch review, the
 * Today board and the minute job's attendance reminders (rules C12, C13, C17–C19, C21, C22).
 */
@Module({
  imports: [AuditModule, AuthModule, FilesModule, NotificationsModule],
  controllers: [
    HrController,
    HrRulesController,
    HrLeaveController,
    HrAttendanceController,
    HrItemsController,
    KioskController,
  ],
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
    HrScope,
    LeaveContext,
    LeaveLedger,
    HrRequestsService,
    LeaveBalancesService,
    LeaveJobs,
    LeaveDirectory,
    LeaveWorkSources,
    HrRequestFileOwner,
    AttendanceWebAuthn,
    AttendanceDays,
    AttendancePasskeys,
    AttendancePasskeysService,
    AttendanceKiosksService,
    AttendanceShoots,
    AttendanceFieldWork,
    AttendanceService,
    AttendanceItems,
    AttendanceItemsService,
    AttendanceReminders,
    KioskStream,
  ],
  exports: [
    HolidayCalendar,
    LeaveDirectory,
    LeaveWorkSources,
    AttendanceShoots,
    AttendanceFieldWork,
  ],
})
export class HrModule {}
