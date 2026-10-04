import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ResolvedAccess } from './resolve-access.js';

/** The signed-in user with their access, as the permissions guard resolved it. */
export interface CurrentUserInfo extends ResolvedAccess {
  id: string;
  name: string;
  email: string;
  /** The session of the request, when it came through the permissions guard. */
  sessionId?: string;
}

export interface RequestWithUser {
  currentUser?: CurrentUserInfo;
}

/** Injects `CurrentUserInfo` into a handler of a `@RequirePermissions`/`@RequireSession` route. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<RequestWithUser>().currentUser;
  if (!user) throw new Error('CurrentUser used on a route the permissions guard does not cover');
  return user;
});
