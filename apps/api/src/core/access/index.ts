/*
 * Access declarations every module puts on its routes (ADR 0013). They are metadata only; the
 * auth module's global guard enforces them.
 */
export {
  ALLOW_PENDING_TWO_FACTOR,
  AllowPendingTwoFactor,
} from './allow-pending-two-factor.decorator.js';
export { REQUIRED_PERMISSIONS, RequirePermissions } from './require-permissions.decorator.js';
export { REQUIRE_SESSION, RequireSession } from './require-session.decorator.js';
