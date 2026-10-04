import { createFileRoute, redirect } from '@tanstack/react-router';
import { CampaignPage } from '../../../features/campaigns/campaign-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/campaigns/$campaignId')({
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'campaigns.read')) throw redirect({ to: '/' });
  },
  component: CampaignRoute,
});

function CampaignRoute() {
  const { campaignId } = Route.useParams();
  return <CampaignPage key={campaignId} campaignId={campaignId} />;
}
