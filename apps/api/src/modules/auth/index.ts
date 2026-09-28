// Public surface of the auth module. Code outside this folder imports from here only.
export { AllowAnonymous, Session, type UserSession } from '@thallesp/nestjs-better-auth';
export { AuthModule } from './auth.module.js';
export { createUser, type NewUser } from './create-user.js';
export { REQUIRED_PERMISSIONS, RequirePermissions } from './require-permissions.decorator.js';
export { REQUIRE_SESSION, RequireSession } from './require-session.decorator.js';
export { RolesService } from './roles.service.js';
