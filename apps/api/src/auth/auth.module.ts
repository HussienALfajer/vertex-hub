import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule as BetterAuthModule } from '@thallesp/nestjs-better-auth';
import type { Database } from '@vertex-hub/db';
import { ENV, type Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { createAuth } from './auth.config.js';
import { MeController } from './me.controller.js';
import { PermissionsGuard } from './permissions.guard.js';
import { RolesService } from './roles.service.js';

/**
 * Authentication (Better Auth, mounted at /api/auth) and authorization. Every route requires a
 * session unless it is marked `@AllowAnonymous()`; `@RequirePermissions()` adds role checks.
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
  controllers: [MeController],
  providers: [RolesService, { provide: APP_GUARD, useClass: PermissionsGuard }],
  exports: [RolesService],
})
export class AuthModule {}
