import { createFileRoute, redirect } from '@tanstack/react-router';
import { LeadsPage, parseLeadsSearch } from '../../../features/leads/leads-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/leads/')({
  validateSearch: parseLeadsSearch,
  // Hidden from users who cannot read leads; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'leads.read')) throw redirect({ to: '/' });
  },
  component: LeadsRoute,
});

function LeadsRoute() {
  return <LeadsPage search={Route.useSearch()} />;
}
