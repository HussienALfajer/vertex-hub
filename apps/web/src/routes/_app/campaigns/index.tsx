import { createFileRoute, redirect } from '@tanstack/react-router';
import { CampaignsPage, parseCampaignsSearch } from '../../../features/campaigns/campaigns-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/campaigns/')({
  validateSearch: parseCampaignsSearch,
  // Hidden from users who cannot read campaigns; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'campaigns.read')) throw redirect({ to: '/' });
  },
  component: CampaignsRoute,
});

function CampaignsRoute() {
  return <CampaignsPage search={Route.useSearch()} />;
}
