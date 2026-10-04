import type { IncomingHttpHeaders } from 'node:http';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, type UserSession } from '@thallesp/nestjs-better-auth';
import { hasPermission, type Permission } from '@vertex-hub/contracts';
import { fromNodeHeaders } from 'better-auth/node';
import {
  ALLOW_PENDING_TWO_FACTOR,
  REQUIRE_SESSION,
  REQUIRED_PERMISSIONS,
} from '../../core/access/index.js';
import { CodedException } from '../../core/errors/index.js';
import { AccessService } from './access.service.js';
import type { RequestWithUser } from './current-user.decorator.js';

interface AuthenticatedRequest extends RequestWithUser {
  headers: IncomingHttpHeaders;
  session?: UserSession | null;
}

/**
 * Global guard for `@RequirePermissions` and `@RequireSession` routes. It resolves the user's
 * access on every request (ADR 0014), refuses archived users, holds back users who must set up
 * two-factor sign-in (F01 rule 15), and checks the required permissions. Better Auth's global
 * AuthGuard handles authentication; this guard does not rely on running after it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    const sessionOnly = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRE_SESSION,
      targets,
    );
    if (!required?.length && !sessionOnly) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session =
      request.session ??
      (await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) }));
    if (!session) throw new UnauthorizedException();

    const resolved = await this.access.resolve(session.user.id);
    if (!resolved) throw new UnauthorizedException();

    const pendingAllowed = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_PENDING_TWO_FACTOR,
      targets,
    );
    if (resolved.twoFactor.required && !resolved.twoFactor.enabled && !pendingAllowed) {
      throw new CodedException(403, 'TWO_FACTOR_REQUIRED', 'Set up two-factor sign-in first');
    }

    if (required && !required.every((permission) => hasPermission(resolved.access, permission))) {
      throw new ForbiddenException();
    }
    request.currentUser = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      sessionId: session.session.id,
      ...resolved,
    };
    return true;
  }
}
