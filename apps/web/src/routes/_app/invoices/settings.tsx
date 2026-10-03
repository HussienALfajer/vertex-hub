import { createFileRoute, redirect } from '@tanstack/react-router';
import { InvoiceSettingsPage } from '../../../features/invoices/invoice-settings-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/invoices/settings')({
  // Every invoice reader sees the settings; managers edit them (the API enforces it).
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'invoices.read')) throw redirect({ to: '/' });
  },
  component: InvoiceSettingsPage,
});
