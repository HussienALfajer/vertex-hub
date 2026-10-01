import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/index.js';
import { ClientsModule } from '../clients/index.js';
import { NotificationsModule } from '../notifications/index.js';
import { TasksModule } from '../tasks/index.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';
import { ScheduleConflicts } from './schedule-conflicts.js';
import { ShootNotices } from './shoot-notices.js';
import { ShootWorkflowService } from './shoot-workflow.service.js';
import { ShootsController } from './shoots.controller.js';
import { ShootsService } from './shoots.service.js';

/**
 * Shoots, meetings and the company calendar (F11, ADR 0022). Owns `shoots`, `shoot_crew`,
 * `shoot_shots`, `meetings`, `meeting_attendees` and `meeting_contacts`. Books, delivers and
 * cancels shoot tasks and creates editing tasks through `tasks`' `ShootTasks`, and registers into
 * its `TaskGuards` so a scheduled shoot holds its task; reads users through `auth`'s
 * `UserDirectory` and clients through `ClientDirectory`; sends the calendar notifications through
 * `notifications`. `tasks`, `clients`, `projects` and `auth` never import it.
 */
@Module({
  imports: [AuthModule, ClientsModule, NotificationsModule, TasksModule],
  controllers: [CalendarController, ShootsController],
  providers: [
    CalendarService,
    ShootsService,
    ShootWorkflowService,
    ScheduleConflicts,
    ShootNotices,
  ],
})
export class CalendarModule {}
