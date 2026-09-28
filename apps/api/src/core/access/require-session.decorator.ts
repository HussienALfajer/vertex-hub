import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SESSION = Symbol('REQUIRE_SESSION');

/**
 * Declares that a route is open to any signed-in user, with no permission check. Better Auth's
 * global guard already requires the session; this marker makes the choice explicit, because every
 * route must declare its access (`@RequirePermissions`, `@RequireSession` or `@AllowAnonymous`).
 */
export const RequireSession = () => SetMetadata(REQUIRE_SESSION, true);
