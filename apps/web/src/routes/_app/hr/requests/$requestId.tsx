import { createFileRoute } from '@tanstack/react-router';
import { HrRequestPage, parseHrRequestSearch } from '../../../../features/hr/hr-request-page';

export const Route = createFileRoute('/_app/hr/requests/$requestId')({
  validateSearch: parseHrRequestSearch,
  component: HrRequestRoute,
});

// The employee and `hr.read` holders covering them read it; others get 404 from the API.
function HrRequestRoute() {
  const { requestId } = Route.useParams();
  return <HrRequestPage key={requestId} id={requestId} search={Route.useSearch()} />;
}
