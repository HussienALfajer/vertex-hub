import { createFileRoute, redirect } from '@tanstack/react-router';
import { parseQuotesSearch, QuotesPage } from '../../../features/quotes/quotes-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/quotes/')({
  validateSearch: parseQuotesSearch,
  // Hidden from users who cannot read quotes; the API refuses them anyway.
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'quotes.read')) throw redirect({ to: '/' });
  },
  component: QuotesRoute,
});

function QuotesRoute() {
  return <QuotesPage search={Route.useSearch()} />;
}
