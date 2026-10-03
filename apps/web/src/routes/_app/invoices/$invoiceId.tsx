import { createFileRoute, redirect } from '@tanstack/react-router';
import { InvoicePage } from '../../../features/invoices/invoice-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/invoices/$invoiceId')({
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'invoices.read')) throw redirect({ to: '/' });
  },
  component: InvoiceRoute,
});

function InvoiceRoute() {
  const { invoiceId } = Route.useParams();
  return <InvoicePage key={invoiceId} invoiceId={invoiceId} />;
}
