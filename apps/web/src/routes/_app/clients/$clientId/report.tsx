import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  ClientReportPage,
  parseClientReportSearch,
} from '../../../../features/reports/client-report-page';
import { reportsFor } from '../../../../features/reports/reports-page';

export const Route = createFileRoute('/_app/clients/$clientId/report')({
  validateSearch: parseClientReportSearch,
  // A client outside the user's report scope answers 404 from the API (spec "API").
  beforeLoad: ({ context, params }) => {
    if (!reportsFor(context.me).clientReport) {
      throw redirect({ to: '/clients/$clientId', params });
    }
  },
  component: ClientReportRoute,
});

function ClientReportRoute() {
  const { clientId } = Route.useParams();
  return <ClientReportPage key={clientId} clientId={clientId} search={Route.useSearch()} />;
}
