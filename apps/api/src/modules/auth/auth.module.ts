import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import type { Database } from '@vertex-hub/db';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { EmailModule, Mailer } from '../email/index.js';
import { AccessService } from './access.service.js';
import { AccountArchiver } from './account-archiver.js';
import { AccountEmails } from './account-emails.js';
import { AccountNotices } from './account-notices.js';
import { createAuth } from './auth.config.js';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from './departments.service.js';
import { DevicePushStates } from './device-push-states.js';
import { IpLocations } from './ip-locations.js';
import { MeController } from './me.controller.js';
import { PasswordLinksController } from './password-links.controller.js';
import { PermissionsGuard } from './permissions.guard.js';
import { ResponsibilityRegistry } from './responsibility-registry.js';
import { SessionActivity } from './session-activity.js';
import { SignedInDevicesController } from './signed-in-devices.controller.js';
import { SignedInDevicesService } from './signed-in-devices.service.js';
import { UserDirectory } from './user-directory.js';
import { UserLifecycle } from './user-lifecycle.js';
import { UserLinksService } from './user-links.service.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

/**
 * Identity and access: Better Auth (mounted at /api/auth, with two-factor sign-in), users, roles
 * and departments (ADR 0014). Every route requires a session unless it is marked
 * `@AllowAnonymous()`; the global guard applies `@RequirePermissions()` and the 2FA requirement.
 */
@Module({
  imports: [
    EmailModule,
    BetterAuthModule.forRootAsync({
      imports: [EmailModule],
      inject: [DATABASE, ENV, Mailer],
      useFactory: (db: Database, env: Env, mailer: Mailer) => ({
        auth: createAuth(db, env, new AccountEmails(db, mailer)),
        // The SPA and the API share one origin (nginx in production, the Vite proxy locally).
        disableTrustedOriginsCors: true,
      }),
    }),
  ],
  controllers: [
    MeController,
    SignedInDevicesController,
    UsersController,
    DepartmentsController,
    PasswordLinksController,
  ],
  providers: [
    AccessService,
    AccountNotices,
    UsersService,
    UserLifecycle,
    AccountArchiver,
    UserLinksService,
    AccountEmails,
    DepartmentsService,
    ResponsibilityRegistry,
    DevicePushStates,
    UserDirectory,
    IpLocations,
    SessionActivity,
    SignedInDevicesService,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [
    ResponsibilityRegistry,
    DevicePushStates,
    UserDirectory,
    AccountNotices,
    UserLifecycle,
    AccountArchiver,
  ],
})
export class AuthModule {}
