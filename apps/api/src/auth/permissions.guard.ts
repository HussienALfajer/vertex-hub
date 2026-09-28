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
import { REQUIRED_PERMISSIONS } from './require-permissions.decorator.js';
import { RolesService } from './roles.service.js';

interface AuthenticatedRequest {
  headers: IncomingHttpHeaders;
  session?: UserSession | null;
}

/**
 * Global guard for `@RequirePermissions`. Better Auth's global AuthGuard handles authentication;
 * this guard does not rely on running after it and loads the session itself when needed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly roles: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session =
      request.session ??
      (await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) }));
    if (!session) throw new UnauthorizedException();

    const roles = await this.roles.rolesOf(session.user.id);
    if (!required.every((permission) => hasPermission(roles, permission))) {
      throw new ForbiddenException();
    }
    return true;
  }
}
