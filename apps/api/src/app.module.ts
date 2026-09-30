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
import { JobsModule } from './core/jobs/index.js';
import { AuditModule } from './modules/audit/index.js';
import { AuthModule } from './modules/auth/index.js';
import { ClientsModule } from './modules/clients/index.js';
import { HealthModule } from './modules/health/index.js';
import { NotificationsModule } from './modules/notifications/index.js';
import { ProjectsModule } from './modules/projects/index.js';
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
          ...(env.NODE_ENV === 'development' && { transport: { target: 'pino-pretty' } }),
        },
      }),
    }),
    DatabaseModule,
    JobsModule,
    AuditModule,
    AuthModule,
    NotificationsModule,
    ClientsModule,
    ProjectsModule,
    TasksModule,
    TemplatesModule,
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
