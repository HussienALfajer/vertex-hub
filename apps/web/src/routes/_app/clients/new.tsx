import { createFileRoute, redirect } from '@tanstack/react-router';
import { NewClientPage } from '../../../features/clients/new-client-page';
import { canAll } from '../../../lib/auth';

export const Route = createFileRoute('/_app/clients/new')({
  // Only scope-all holders create clients (F02 rule 5); the API refuses anyone else.
  beforeLoad: ({ context }) => {
    if (!canAll(context.me, 'clients.manage')) throw redirect({ to: '/clients' });
  },
  component: NewClientPage,
});
