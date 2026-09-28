import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewUserPage } from '../../../features/users/new-user-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/team/new')({
  // Hidden from users who cannot create accounts; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'users.manage')) throw redirect({ to: '/team' });
  },
  component: NewUserPage,
});
