import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { QuoteDetail, QuoteLine, QuoteSection } from '@vertex-hub/contracts';
import {
  Button,
  Card,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  CalendarPlusIcon,
  CopyPlusIcon,
  FolderKanbanIcon,
  RepeatIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { EmailHistory } from '../email/email-history';
import { LeadBadge } from '../leads/lead-badges';
import { AcceptDialog } from './accept-dialog';
import {
  ApprovalBadge,
  DiscardedBadge,
  ExpiresSoonBadge,
  formatBasisPoints,
  Money,
  QuoteStatusBadge,
} from './quote-badges';
import { QuoteBuilder } from './quote-builder';
import { ExtendDialog, RejectDialog } from './quote-dialogs';
import { QuoteEmailActions } from './quote-email';
import { SentPdf } from './quote-pdf';
import { quoteQuery, useCreateVersion } from './quotes.queries';

/** Spec screens 4 and 5: the builder while a draft, the quote as sent afterwards. */
export function QuotePage({ quoteId }: { quoteId: string }) {
  const { t } = useTranslation();
  const quote = useQuery(quoteQuery(quoteId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/quotes" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('quotes.back')}
        </Button>
      </div>
      {quote.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      ) : quote.isError ? (
        <LoadError
          message={isMissing(quote.error) ? t('quotes.notFound') : t('quotes.loadOneError')}
          onRetry={() => quote.refetch()}
          error={quote.error}
        />
      ) : (
        <>
          <QuoteHeader quote={quote.data} />
          {quote.data.status === 'draft' ? (
            <QuoteBuilder quote={quote.data} />
          ) : (
            <SentQuote quote={quote.data} />
          )}
        </>
      )}
    </>
  );
}

function QuoteHeader({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  return (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          {quote.title}
          <QuoteStatusBadge status={quote.status} />
          <ApprovalBadge approval={quote.discountApproval} />
          {quote.archivedAt && <DiscardedBadge />}
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span dir="ltr" className="tabular-nums">
            {quote.displayNumber}
          </span>
          {quote.client ? (
            <Link
              to="/clients/$clientId"
              params={{ clientId: quote.client.id }}
              search={{ tab: 'quotes' }}
              className="hover:underline"
            >
              {quote.client.name}
            </Link>
          ) : quote.lead && can(me, 'leads.read') ? (
            <Link
              to="/leads/$leadId"
              params={{ leadId: quote.lead.id }}
              className="hover:underline"
            >
              {quote.recipient.name}
            </Link>
          ) : (
            <span>{quote.recipient.name}</span>
          )}
          {!quote.client && quote.lead && <LeadBadge />}
          {quote.contact && <span>{t('quotes.addressedTo', { name: quote.contact.name })}</span>}
          <span>{t('quotes.accountManagerIs', { name: quote.accountManager.name })}</span>
        </span>
      }
    />
  );
}

/** A quote that left the builder: as the client sees it, with its state and what comes next. */
function SentQuote({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const version = useCreateVersion(quote.id);
  const [open, setOpen] = useState<'accept' | 'extend' | 'reject' | null>(null);
  const { permissions } = quote;

  async function newVersion() {
    try {
      const draft = await version.mutateAsync();
      toast.add({ title: t('quotes.versions.created'), type: 'success' });
      await navigate({ to: '/quotes/$quoteId', params: { quoteId: draft.id } });
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SentPdf quote={quote} />
        <QuoteEmailActions quote={quote} />
        {permissions.canAccept && (
          <Button onClick={() => setOpen('accept')}>
            <ThumbsUpIcon />
            {t('quotes.accept.action')}
          </Button>
        )}
        {permissions.canExtend && (
          <Button variant="outline" onClick={() => setOpen('extend')}>
            <CalendarPlusIcon />
            {t('quotes.extend.action')}
          </Button>
        )}
        {permissions.canReject && (
          <Button variant="outline" onClick={() => setOpen('reject')}>
            <ThumbsDownIcon />
            {t('quotes.reject.action')}
          </Button>
        )}
        {permissions.canCreateVersion && (
          <Button variant="outline" disabled={version.isPending} onClick={newVersion}>
            <CopyPlusIcon />
            {t('quotes.versions.new')}
          </Button>
        )}
        {quote.project && (
          <Button
            variant="ghost"
            render={<Link to="/projects/$projectId" params={{ projectId: quote.project.id }} />}
          >
            <FolderKanbanIcon />
            {quote.project.name}
          </Button>
        )}
        {quote.retainer && (
          <Button
            variant="ghost"
            render={<Link to="/retainers/$retainerId" params={{ retainerId: quote.retainer.id }} />}
          >
            <RepeatIcon />
            {quote.retainer.name}
          </Button>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <QuoteSectionView quote={quote} section="one_off" />
          <QuoteSectionView quote={quote} section="monthly" />
          {(quote.clientNotes || quote.terms) && (
            <Card className="gap-4 p-6">
              {quote.clientNotes && (
                <div className="flex flex-col gap-1">
                  <h2 className="font-bold">{t('quotes.builder.clientNotes')}</h2>
                  <p className="text-sm whitespace-pre-line">{quote.clientNotes}</p>
                </div>
              )}
              {quote.terms && (
                <div className="flex flex-col gap-1">
                  <h2 className="font-bold">{t('quotes.builder.terms')}</h2>
                  <p className="text-sm whitespace-pre-line">{quote.terms}</p>
                </div>
              )}
            </Card>
          )}
        </div>
        <aside className="flex flex-col gap-6">
          <Facts quote={quote} />
          {quote.response && <Response quote={quote} />}
          <Versions quote={quote} />
          {quote.client && <EmailHistory target={{ type: 'quote', id: quote.id }} />}
        </aside>
      </div>

      <AcceptDialog quote={quote} open={open === 'accept'} onClose={() => setOpen(null)} />
      <ExtendDialog quote={quote} open={open === 'extend'} onClose={() => setOpen(null)} />
      <RejectDialog quote={quote} open={open === 'reject'} onClose={() => setOpen(null)} />
    </>
  );
}

function QuoteSectionView({ quote, section }: { quote: QuoteDetail; section: QuoteSection }) {
  const { t } = useTranslation();
  const lines = quote.lines.filter((line) => line.section === section);
  if (lines.length === 0) return null;
  const totals = section === 'one_off' ? quote.totals.oneOff : quote.totals.monthly;
  const perMonth = section === 'monthly';
  return (
    <Card className="gap-4 p-6">
      <h2 className="text-lg font-bold">{t(`quotes.sections.${section}`)}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('quotes.builder.service')}</TableHead>
            <TableHead className="text-end">{t('quotes.builder.quantity')}</TableHead>
            <TableHead className="text-end">{t('quotes.builder.unitPrice')}</TableHead>
            <TableHead className="text-end">{t('quotes.totals.lineTotal')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <LineRow key={line.id} line={line} quote={quote} />
          ))}
        </TableBody>
      </Table>
      <dl className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <dt className="text-muted-foreground">{t('quotes.totals.subtotal')}</dt>
        <dd className="text-end">
          <Money minor={totals.subtotalMinor} currency={quote.currency} />
        </dd>
        {totals.discountMinor > 0 && (
          <>
            <dt className="text-muted-foreground">{t('quotes.totals.discount')}</dt>
            <dd className="text-end">
              <Money minor={totals.discountMinor} currency={quote.currency} />
            </dd>
          </>
        )}
        <dt className="font-bold">
          {perMonth ? t('quotes.totals.netPerMonth') : t('quotes.totals.net')}
        </dt>
        <dd className="text-end text-lg font-bold">
          <Money minor={totals.netMinor} currency={quote.currency} />
        </dd>
        {perMonth &&
          quote.monthlyTermMonths !== null &&
          quote.totals.monthlyTermTotalMinor !== null && (
            <>
              <dt className="text-muted-foreground">
                {t('quotes.totals.termOf', { n: formatNumber(quote.monthlyTermMonths) })}
              </dt>
              <dd className="text-end">
                <Money minor={quote.totals.monthlyTermTotalMinor} currency={quote.currency} />
              </dd>
            </>
          )}
        {/* Rule 14: effective discounts are internal, never printed. */}
        <dt className="text-muted-foreground">{t('quotes.totals.effectiveDiscountInternal')}</dt>
        <dd className="text-end tabular-nums">
          {formatBasisPoints(totals.effectiveDiscountBasisPoints)}
        </dd>
      </dl>
      {section === 'one_off' && quote.installments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-bold">{t('quotes.installments.title')}</h3>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {quote.installments.map((installment) => (
              <li key={installment.id} className="flex items-center gap-3 px-4 py-2">
                <span className="flex-1">{installment.name}</span>
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(installment.percent / 100, { style: 'percent' })}
                </span>
                <Money minor={installment.amountMinor} currency={quote.currency} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function LineRow({ line, quote }: { line: QuoteLine; quote: QuoteDetail }) {
  const { t } = useTranslation();
  return (
    <TableRow>
      <TableCell className="whitespace-normal">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-medium">{line.name}</span>
          {line.description && (
            <span className="text-sm text-muted-foreground">{line.description}</span>
          )}
          {line.items.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {line.items
                .map((item) =>
                  t('catalog.packages.item', { n: formatNumber(item.quantity), name: item.name }),
                )
                .join(' · ')}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-end tabular-nums">{formatNumber(line.quantity)}</TableCell>
      <TableCell className="text-end">
        <Money minor={line.unitPriceMinor} currency={quote.currency} />
      </TableCell>
      <TableCell className="text-end">
        <Money minor={line.totalMinor} currency={quote.currency} />
      </TableCell>
    </TableRow>
  );
}

function Facts({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-3 p-5">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {quote.validUntil && (
          <>
            <dt className="text-muted-foreground">{t('quotes.columns.validUntil')}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              {formatCalendarDate(quote.validUntil)}
              {quote.expiresSoon && <ExpiresSoonBadge />}
            </dd>
          </>
        )}
        {quote.sentAt && quote.sentBy && (
          <>
            <dt className="text-muted-foreground">{t('quotes.facts.sent')}</dt>
            <dd>
              {t('quotes.facts.byAt', {
                name: quote.sentBy.name,
                when: formatDateTime(quote.sentAt),
              })}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('quotes.facts.created')}</dt>
        <dd>
          {t('quotes.facts.byAt', {
            name: quote.createdBy.name,
            when: formatDateTime(quote.createdAt),
          })}
        </dd>
        <dt className="text-muted-foreground">{t('quotes.form.currency')}</dt>
        <dd>{t(`quotes.currencies.${quote.currency}`)}</dd>
      </dl>
    </Card>
  );
}

function Response({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  const response = quote.response;
  if (!response) return null;
  return (
    <Card className="gap-3 p-5">
      <h2 className="font-bold">{t('quotes.response.title')}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('quotes.response.respondedOn')}</dt>
        <dd>{formatCalendarDate(response.respondedOn)}</dd>
        {response.rejectionReason && (
          <>
            <dt className="text-muted-foreground">{t('quotes.reject.reason')}</dt>
            <dd>{t(`quotes.rejectionReasons.${response.rejectionReason}`)}</dd>
          </>
        )}
        {response.contact && (
          <>
            <dt className="text-muted-foreground">{t('quotes.response.contact')}</dt>
            <dd>{response.contact.name}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('quotes.response.recordedBy')}</dt>
        <dd>{response.by.name}</dd>
      </dl>
      {response.note && <p className="text-sm whitespace-pre-line">{response.note}</p>}
    </Card>
  );
}

function Versions({ quote }: { quote: QuoteDetail }) {
  const { t } = useTranslation();
  if (quote.versions.length < 2) return null;
  return (
    <Card className="gap-3 p-5">
      <h2 className="font-bold">{t('quotes.versions.title')}</h2>
      <ul className="flex flex-col gap-2">
        {quote.versions.map((version) => (
          <li key={version.id} className="flex items-center justify-between gap-3 text-sm">
            {version.id === quote.id ? (
              <span aria-current="page" className="font-bold">
                {t('quotes.versions.version', { n: formatNumber(version.version) })}
              </span>
            ) : (
              <Link
                to="/quotes/$quoteId"
                params={{ quoteId: version.id }}
                className="hover:underline"
              >
                {t('quotes.versions.version', { n: formatNumber(version.version) })}
              </Link>
            )}
            <QuoteStatusBadge status={version.status} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
