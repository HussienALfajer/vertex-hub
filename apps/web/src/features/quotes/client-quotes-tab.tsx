import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ClientDetailResponse, QUOTE_STATUSES, type Quote } from '@vertex-hub/contracts';
import { Button, EmptyState, Skeleton } from '@vertex-hub/ui';
import { CalendarIcon, FileTextIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { TabHeader } from '../../components/tab-header';
import { canAll, scopesOf, useMe } from '../../lib/auth';
import { formatCalendarDate } from '../../lib/format';
import { NewQuoteDialog } from './new-quote-dialog';
import { ApprovalBadge, ExpiresSoonBadge, Money, QuoteStatusBadge } from './quote-badges';
import { quoteListQuery } from './quotes.queries';

/** Spec screen 7: the client's quotes, the latest version of each, with "New quote". */
export function ClientQuotesTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const quotes = useQuery(
    quoteListQuery({ clientId: client.id, status: [...QUOTE_STATUSES], pageSize: 100 }),
  );
  // Rule 1: quotes are made for a non-archived client that is active or paused.
  const canCreate =
    client.archivedAt === null &&
    client.status !== 'ended' &&
    (canAll(me, 'quotes.manage') ||
      (scopesOf(me, 'quotes.manage').includes('own_clients') &&
        client.accountManager.id === me.user.id));
  const newQuote = canCreate && (
    <Button size="sm" onClick={() => setCreating(true)}>
      <PlusIcon />
      {t('quotes.new.action')}
    </Button>
  );
  const items = quotes.data?.items ?? [];

  return (
    <>
      <TabHeader
        title={t('quotes.clientTab.title')}
        description={t('quotes.clientTab.hint')}
        action={items.length > 0 && newQuote}
      />
      {quotes.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : quotes.isError ? (
        <LoadError message={t('quotes.loadError')} onRetry={() => quotes.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileTextIcon />}
          title={t('quotes.clientTab.emptyTitle')}
          description={canCreate ? t('quotes.clientTab.emptyHint') : undefined}
          action={newQuote}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((quote) => (
            <QuoteCard key={quote.id} quote={quote} />
          ))}
        </ul>
      )}
      {canCreate && (
        <NewQuoteDialog open={creating} onClose={() => setCreating(false)} clientId={client.id} />
      )}
    </>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  const { t } = useTranslation();
  const closed = !['draft', 'sent', 'expired'].includes(quote.status);
  return (
    <li>
      <Link
        to="/quotes/$quoteId"
        params={{ quoteId: quote.id }}
        data-closed={closed || undefined}
        className="group flex h-full flex-col gap-4 rounded-lg border border-border bg-surface p-5 transition-colors duration-150 ease-out outline-offset-4 hover:border-primary data-closed:bg-muted/40"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-bold group-hover:underline">{quote.title}</h3>
            <span dir="ltr" className="text-start text-xs text-muted-foreground tabular-nums">
              {quote.displayNumber}
            </span>
          </div>
          <span className="flex flex-wrap justify-end gap-1.5">
            <QuoteStatusBadge status={quote.status} />
            <ApprovalBadge approval={quote.discountApproval} />
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{t('quotes.columns.oneOff')}</dt>
            <dd>
              <Money minor={quote.oneOffNetMinor} currency={quote.currency} />
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">{t('quotes.columns.monthly')}</dt>
            <dd>
              <Money minor={quote.monthlyNetMinor} currency={quote.currency} />
            </dd>
          </div>
        </dl>
        {quote.validUntil && (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
            <CalendarIcon aria-hidden="true" className="size-4" />
            {t('quotes.validUntilOn', { date: formatCalendarDate(quote.validUntil) })}
            {quote.expiresSoon && <ExpiresSoonBadge />}
          </div>
        )}
      </Link>
    </li>
  );
}
