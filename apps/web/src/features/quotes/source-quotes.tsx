import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { FileTextIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { can, useMe } from '../../lib/auth';
import { quoteListQuery } from './quotes.queries';

/**
 * Spec screen 8: the accepted quotes an engagement came from ("From quote Q-…"), for quote
 * readers, as an item of the page header's facts. A retainer renewed by later quotes lists each.
 */
export function SourceQuotes(engagement: { projectId: string } | { retainerId: string }) {
  const { t } = useTranslation();
  const me = useMe();
  const quotes = useQuery({
    ...quoteListQuery({
      ...engagement,
      status: ['accepted'],
      latestOnly: 'false',
      sort: 'number',
      order: 'asc',
    }),
    enabled: can(me, 'quotes.read'),
  });
  const items = quotes.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <FileTextIcon aria-hidden="true" className="size-4" />
        {t('quotes.fromQuote')}
      </dt>
      <dd className="flex flex-wrap gap-x-3">
        {items.map((quote) => (
          <Link
            key={quote.id}
            to="/quotes/$quoteId"
            params={{ quoteId: quote.id }}
            dir="ltr"
            className="font-medium tabular-nums hover:underline"
          >
            {quote.displayNumber}
          </Link>
        ))}
      </dd>
    </div>
  );
}
