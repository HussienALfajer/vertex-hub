import { createFileRoute, redirect } from '@tanstack/react-router';
import { hasReports, ReportsPage } from '../../../features/reports/reports-page';

export const Route = createFileRoute('/_app/reports/')({
  beforeLoad: ({ context }) => {
    if (!hasReports(context.me)) throw redirect({ to: '/' });
  },
  component: ReportsPage,
});
