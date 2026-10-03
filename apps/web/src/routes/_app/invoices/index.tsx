import { createFileRoute, redirect } from '@tanstack/react-router';
import { InvoicesPage, parseInvoicesSearch } from '../../../features/invoices/invoices-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/invoices/')({
  validateSearch: parseInvoicesSearch,
  // Hidden from users who cannot read invoices; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'invoices.read')) throw redirect({ to: '/' });
  },
  component: InvoicesRoute,
});

function InvoicesRoute() {
  return <InvoicesPage search={Route.useSearch()} />;
}
