import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@vertex-hub/contracts';

export const REQUIRED_PERMISSIONS = Symbol('REQUIRED_PERMISSIONS');

/**
 * Requires a signed-in user whose roles grant every listed permission (from the shared map in
 * `@vertex-hub/contracts`). Record-level scopes are applied by the service handling the request.
 */
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
