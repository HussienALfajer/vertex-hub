import { createFileRoute } from '@tanstack/react-router';
import { RequestPage } from '../../../../features/approvals/request-page';

export const Route = createFileRoute('/_app/approvals/requests/$requestId')({
  component: RequestRoute,
});

function RequestRoute() {
  const { requestId } = Route.useParams();
  return <RequestPage key={requestId} requestId={requestId} />;
}
