import { createFileRoute, redirect } from '@tanstack/react-router';
import { EmailLogPage, parseEmailLogSearch } from '../../features/email/email-log-page';
import { can } from '../../lib/auth';

export const Route = createFileRoute('/_app/emails')({
  validateSearch: parseEmailLogSearch,
  // Hidden from users without audit.read; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'audit.read')) throw redirect({ to: '/' });
  },
  component: EmailsRoute,
});

function EmailsRoute() {
  return <EmailLogPage search={Route.useSearch()} />;
}
