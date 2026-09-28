import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@vertex-hub/contracts';

export const REQUIRED_PERMISSIONS = Symbol('REQUIRED_PERMISSIONS');

/**
 * Requires a signed-in user whose effective permissions (roles and department capabilities,
 * ADR 0014, from `@vertex-hub/contracts`) include every listed permission. Record-level scopes
 * are applied by the service handling the request.
 */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
