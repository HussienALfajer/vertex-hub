import { createFileRoute, redirect } from '@tanstack/react-router';
import { reportsFor } from '../../../features/reports/reports-page';
import { parseRevenueSearch, RevenuePage } from '../../../features/reports/revenue-page';

export const Route = createFileRoute('/_app/reports/revenue')({
  validateSearch: parseRevenueSearch,
  beforeLoad: ({ context }) => {
    if (!reportsFor(context.me).finance) throw redirect({ to: '/' });
  },
  component: RevenueRoute,
});

function RevenueRoute() {
  return <RevenuePage search={Route.useSearch()} />;
}
