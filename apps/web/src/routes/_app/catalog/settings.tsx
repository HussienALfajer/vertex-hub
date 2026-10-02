import { createFileRoute, redirect } from '@tanstack/react-router';
import { QuoteSettingsPage } from '../../../features/quotes/quote-settings-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/catalog/settings')({
  // Every quote reader sees the settings; managers edit them (the API enforces it).
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'quotes.read')) throw redirect({ to: '/' });
  },
  component: QuoteSettingsPage,
});
