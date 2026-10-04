import {
  Module,
  StandardSchemaSerializerInterceptor,
  StandardSchemaValidationPipe,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './core/config/config.module.js';
import { ENV, type Env } from './core/config/env.js';
import { DatabaseModule } from './core/database/database.module.js';
import { DatabaseErrorFilter } from './core/errors/database-error.filter.js';
import { redactLoggedRequest } from './core/http/redact-link-token.js';
import { JobsModule } from './core/jobs/index.js';
import { ApprovalsModule } from './modules/approvals/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { CalendarModule } from './modules/calendar/index.js';
import { CampaignsModule } from './modules/campaigns/index.js';
import { CatalogModule } from './modules/catalog/index.js';
import { ClientsModule } from './modules/clients/index.js';
import { ContentModule } from './modules/content/index.js';
import { FilesModule } from './modules/files/index.js';
import { HealthModule } from './modules/health/index.js';
import { InvoicesModule } from './modules/invoices/index.js';
import { LeadsModule } from './modules/leads/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { ProjectsModule } from './modules/projects/index.js';
import { QuotesModule } from './modules/quotes/index.js';
import { TasksModule } from './modules/tasks/index.js';
import { TemplatesModule } from './modules/templates/index.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          // The token of an approval link is in the URL of its public routes (F09).
          serializers: { req: redactLoggedRequest },
          ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
        },
      }),
    }),
    DatabaseModule,
    JobsModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    FilesModule,
    ClientsModule,
    ProjectsModule,
    TasksModule,
    ContentModule,
    CalendarModule,
    ApprovalsModule,
    TemplatesModule,
    CatalogModule,
    QuotesModule,
    InvoicesModule,
    LeadsModule,
    CampaignsModule,
    HealthModule,
  ],
  providers: [
    // Validates every parameter declared with `{ schema }` (Zod through Standard Schema).
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
    // Shapes responses declared with `@SerializeOptions({ schema })`, dropping unknown fields.
    { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
    // A write that lost a race (unique index, deadlock) answers its coded 409, not a 500.
    { provide: APP_FILTER, useClass: DatabaseErrorFilter },
  ],
})
export class AppModule {}
