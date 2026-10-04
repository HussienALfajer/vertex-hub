import { createFileRoute, redirect } from '@tanstack/react-router';
import {
  OverdueInvoicesPage,
  parseOverdueInvoicesSearch,
} from '../../../features/reports/overdue-invoices-page';
import { reportsFor } from '../../../features/reports/reports-page';

export const Route = createFileRoute('/_app/reports/overdue-invoices')({
  validateSearch: parseOverdueInvoicesSearch,
  beforeLoad: ({ context }) => {
    if (!reportsFor(context.me).finance) throw redirect({ to: '/' });
  },
  component: OverdueInvoicesRoute,
});

function OverdueInvoicesRoute() {
  return <OverdueInvoicesPage search={Route.useSearch()} />;
}
