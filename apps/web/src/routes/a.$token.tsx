import { createFileRoute } from '@tanstack/react-router';
import { PublicApprovalPage } from '../features/approvals/public-approval-page';

/** Public: the client's approval link (`/a/<token>`), outside the app shell, with no session. */
export const Route = createFileRoute('/a/$token')({
  component: PublicApprovalRoute,
});

function PublicApprovalRoute() {
  const { token } = Route.useParams();
  return <PublicApprovalPage key={token} token={token} />;
}
