import { createFileRoute, redirect } from '@tanstack/react-router';
import { QuotePage } from '../../../features/quotes/quote-page';
import { can } from '../../../lib/auth';

export const Route = createFileRoute('/_app/quotes/$quoteId')({
  beforeLoad: ({ context }) => {
    if (!can(context.me, 'quotes.read')) throw redirect({ to: '/' });
  },
  component: QuoteRoute,
});

function QuoteRoute() {
  const { quoteId } = Route.useParams();
  return <QuotePage key={quoteId} quoteId={quoteId} />;
}
