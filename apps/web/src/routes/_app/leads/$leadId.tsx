import { createFileRoute, redirect } from '@tanstack/react-router';
import { LeadPage } from '../../../features/leads/lead-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/leads/$leadId')({
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'leads.read')) throw redirect({ to: '/' });
  },
  component: LeadRoute,
});

function LeadRoute() {
  const { leadId } = Route.useParams();
  return <LeadPage key={leadId} leadId={leadId} />;
}
