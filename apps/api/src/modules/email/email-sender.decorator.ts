import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The signed-in user as an email sender. */
export interface EmailSender {
  id: string;
  name: string;
  email: string;
}

/**
 * The signed-in user that the permissions guard set on the request. `email` imports no other
 * module (ADR 0028; `auth` queues emails), so it reads the guard's result without `CurrentUser`.
 */
export const CurrentSender = createParamDecorator(
  (_: unknown, context: ExecutionContext): EmailSender => {
    const user = context.switchToHttp().getRequest<{ currentUser?: EmailSender }>().currentUser;
    if (!user) {
      throw new Error('CurrentSender used on a route the permissions guard does not cover');
    }
    return { id: user.id, name: user.name, email: user.email };
  },
);
