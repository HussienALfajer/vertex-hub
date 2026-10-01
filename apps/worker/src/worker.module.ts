import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './core/config/config.module.js';
import { ENV, type Env } from './core/config/env.js';
import { DatabaseModule } from './core/database/database.module.js';
import { ApprovalsRemindersJob } from './jobs/approvals-reminders.job.js';
import { FilesPurgeUploadsJob } from './jobs/files-purge-uploads.job.js';
import { HeartbeatJob } from './jobs/heartbeat.job.js';
import { NotificationsDailyJob } from './jobs/notifications-daily.job.js';
import { PgBossService } from './jobs/pg-boss.service.js';
import { RetainerCyclesJob } from './jobs/retainer-cycles.job.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
        },
      }),
    }),
    DatabaseModule,
  ],
  providers: [
    PgBossService,
    HeartbeatJob,
    RetainerCyclesJob,
    NotificationsDailyJob,
    FilesPurgeUploadsJob,
    ApprovalsRemindersJob,
  ],
})
export class WorkerModule {}
