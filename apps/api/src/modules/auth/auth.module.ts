import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import type { Database } from '@vertex-hub/db';
import { ENV, type Env } from '../../core/config/env.js';
import { DATABASE } from '../../core/database/database.module.js';
import { AccessService } from './access.service.js';
import { createAuth } from './auth.config.js';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from './departments.service.js';
import { MeController } from './me.controller.js';
import { PasswordLinksController } from './password-links.controller.js';
import { PermissionsGuard } from './permissions.guard.js';
import { ResponsibilityRegistry } from './responsibility-registry.js';
import { UserDirectory } from './user-directory.js';
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
    BetterAuthModule.forRootAsync({
      inject: [DATABASE, ENV],
      useFactory: (db: Database, env: Env) => ({
        auth: createAuth(db, env),
        // The SPA and the API share one origin (nginx in production, the Vite proxy locally).
        disableTrustedOriginsCors: true,
      }),
    }),
  ],
  controllers: [MeController, UsersController, DepartmentsController, PasswordLinksController],
  providers: [
    AccessService,
    UsersService,
    UserLinksService,
    DepartmentsService,
    ResponsibilityRegistry,
    UserDirectory,
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [ResponsibilityRegistry, UserDirectory],
})
export class AuthModule {}
