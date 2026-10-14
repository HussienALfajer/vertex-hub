import { createFileRoute, redirect } from '@tanstack/react-router';
import { CycleReportPage } from '../../../../../../features/reports/cycle-report-page';
import { reportsFor } from '../../../../../../features/reports/reports-page';

export const Route = createFileRoute('/_app/retainers/$retainerId/cycles/$cycleId/report')({
  // A cycle outside the user's report scope, or a backdated one, answers 404 (spec F05C "API").
  beforeLoad: ({ context, params }) => {
    if (!reportsFor(context.me).clientReport) {
      throw redirect({ to: '/retainers/$retainerId', params: { retainerId: params.retainerId } });
    }
  },
  component: CycleReportRoute,
});

function CycleReportRoute() {
  const { retainerId, cycleId } = Route.useParams();
  return <CycleReportPage key={cycleId} retainerId={retainerId} cycleId={cycleId} />;
}
