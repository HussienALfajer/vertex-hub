import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  businessDate,
  type ClientStatement,
  type ClientStatementQuery,
  CURRENCIES,
  type Currency,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@vertex-hub/ui';
import { DownloadIcon, FileTextIcon, LoaderCircleIcon, ScrollTextIcon } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatCalendarDate } from '../../lib/format';
import { useFocusAfterChange } from '../../lib/use-focus-after-change';
import { ChoiceSelect } from '../quotes/choice-select';
import { Money } from '../quotes/quote-badges';
import { StatementEmailButton } from './invoice-email';
import {
  clientStatementQuery,
  invoicesKeys,
  statementPdfReadyQuery,
  statementPdfUrl,
  useRenderStatement,
} from './invoices.queries';
import { BillingSection } from './project-billing-tab';

/**
 * Rule 28: the client's statement in one currency over a period (the current year to today by
 * default), with its PDF (rule 29). The currency starts at the first one the client was invoiced in.
 */
export function StatementSection({
  clientId,
  currencies,
}: {
  clientId: string;
  /** The currencies the client was invoiced in. */
  currencies: Currency[];
}) {
  const { t } = useTranslation();
  const ids = { currency: useId() };
  const today = businessDate();
  const [currency, setCurrency] = useState<Currency>(currencies[0] ?? 'USD');
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const validDates = !!from && !!to && from <= to;
  const query: ClientStatementQuery = { currency, from, to };
  const statement = useQuery({ ...clientStatementQuery(clientId, query), enabled: validDates });

  const currencyItems = CURRENCIES.map((code) => ({
    value: code,
    label: t(`invoices.currencies.${code}`),
  }));

  return (
    <BillingSection
      title={t('invoices.statement.heading')}
      action={
        validDates &&
        statement.isSuccess && (
          <StatementPdf
            key={JSON.stringify(query)}
            clientId={clientId}
            query={query}
            statement={statement.data}
          />
        )
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel id={ids.currency} render={<span />}>
            {t('invoices.statement.currency')}
          </FieldLabel>
          <ChoiceSelect
            labelledBy={ids.currency}
            items={currencyItems}
            value={currency}
            onChange={(next) => setCurrency(next as Currency)}
          />
        </Field>
        <Field invalid={!validDates}>
          <FieldLabel>{t('invoices.statement.from')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </Field>
        <Field invalid={!validDates}>
          <FieldLabel>{t('invoices.statement.to')}</FieldLabel>
          <Input type="date" dir="ltr" value={to} onChange={(event) => setTo(event.target.value)} />
          <FieldError match={!validDates}>{t('invoices.statement.errors.dates')}</FieldError>
        </Field>
      </div>
      {!validDates ? null : statement.isPending ? (
        <Skeleton className="h-48" />
      ) : statement.isError ? (
        <LoadError
          message={t('invoices.statement.loadError')}
          onRetry={() => statement.refetch()}
          error={statement.error}
        />
      ) : (
        <StatementTable statement={statement.data} />
      )}
    </BillingSection>
  );
}

function StatementTable({ statement }: { statement: ClientStatement }) {
  const { t } = useTranslation();
  const { currency } = statement;
  const money = (minor: number) => <Money minor={minor} currency={currency} />;
  const empty = <span className="text-muted-foreground">{t('common.none')}</span>;

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">{t('invoices.statement.invoiced')}</dt>
          <dd className="font-medium">{money(statement.invoicedMinor)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">{t('invoices.statement.paid')}</dt>
          <dd className="font-medium">{money(statement.paidMinor)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground">{t('invoices.statement.outstanding')}</dt>
          <dd className="font-bold">{money(statement.outstandingMinor)}</dd>
        </div>
      </dl>
      {statement.rows.length === 0 && statement.openingMinor === 0 ? (
        <EmptyState
          icon={<ScrollTextIcon />}
          title={t('invoices.statement.empty')}
          description={t('invoices.statement.emptyHint')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoices.statement.date')}</TableHead>
              <TableHead>{t('invoices.statement.document')}</TableHead>
              <TableHead className="text-end">{t('invoices.statement.debit')}</TableHead>
              <TableHead className="text-end">{t('invoices.statement.credit')}</TableHead>
              <TableHead className="text-end">{t('invoices.statement.balance')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{formatCalendarDate(statement.from)}</TableCell>
              <TableCell className="font-medium">{t('invoices.statement.opening')}</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-end">{money(statement.openingMinor)}</TableCell>
            </TableRow>
            {statement.rows.map((row) => (
              <TableRow key={`${row.kind}-${row.id}`}>
                <TableCell>{formatCalendarDate(row.date)}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={row.kind === 'invoice' ? 'info' : 'brand'}>
                      {t(`invoices.statement.kinds.${row.kind}`)}
                    </Badge>
                    <Link
                      to="/invoices/$invoiceId"
                      params={{ invoiceId: row.invoiceId }}
                      className="rounded-sm font-medium outline-offset-2 hover:underline"
                    >
                      <span dir="ltr" className="tabular-nums">
                        {row.number}
                      </span>
                    </Link>
                    {row.kind === 'payment' && (
                      <span className="text-xs text-muted-foreground">
                        {t('invoices.statement.paysInvoice', { number: row.invoiceNumber })}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  {row.debitMinor > 0 ? money(row.debitMinor) : empty}
                </TableCell>
                <TableCell className="text-end">
                  {row.kind === 'payment' ? (
                    <span className="flex flex-col items-end">
                      {money(row.creditMinor)}
                      {row.original && (
                        <span className="text-xs text-muted-foreground">
                          <Money
                            minor={row.original.amountMinor}
                            currency={row.original.currency}
                          />
                        </span>
                      )}
                    </span>
                  ) : (
                    empty
                  )}
                </TableCell>
                <TableCell className="text-end">{money(row.balanceMinor)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>{formatCalendarDate(statement.to)}</TableCell>
              <TableCell className="font-bold">{t('invoices.statement.closing')}</TableCell>
              <TableCell />
              <TableCell />
              <TableCell className="text-end font-bold">{money(statement.closingMinor)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * Rule 29: the statement's PDF is rendered on request; once asked for, the page looks for it
 * until it is ready, then offers the download (valid for 24 hours).
 */
function StatementPdf({
  clientId,
  query,
  statement,
}: {
  clientId: string;
  query: ClientStatementQuery;
  statement: ClientStatement;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const render = useRenderStatement(clientId);
  const [asked, setAsked] = useState(false);
  const ready = useQuery({ ...statementPdfReadyQuery(clientId, query), enabled: asked });
  const state = !asked
    ? 'idle'
    : ready.isSuccess
      ? 'ready'
      : ready.isError
        ? 'failed'
        : 'preparing';
  const prepareRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  useFocusAfterChange(state, () => (state === 'ready' ? downloadRef.current : prepareRef.current));

  async function ask() {
    try {
      await render.mutateAsync(query);
      // Asking again after giving up looks for the new render from the start.
      await queryClient.resetQueries({ queryKey: invoicesKeys.statementPdf(clientId, query) });
      setAsked(true);
    } catch (error) {
      toast.add({ title: errorMessage(t, error), type: 'error' });
    }
  }

  if (state === 'ready') {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          render={
            <a
              ref={downloadRef}
              href={statementPdfUrl(clientId, query)}
              target="_blank"
              rel="noopener"
            />
          }
        >
          <DownloadIcon />
          {t('invoices.statement.download')}
        </Button>
        <StatementEmailButton clientId={clientId} query={query} statement={statement} />
      </span>
    );
  }
  // One button while it is asked for and prepared, so the focus stays on it.
  const preparing = state === 'preparing';
  return (
    <span className="flex flex-wrap items-center gap-2">
      {state === 'failed' && <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>}
      <Button
        ref={prepareRef}
        variant="outline"
        size="sm"
        disabled={preparing || render.isPending}
        focusableWhenDisabled
        onClick={ask}
      >
        {preparing ? (
          <LoaderCircleIcon
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <FileTextIcon />
        )}
        {preparing
          ? t('invoices.statement.preparing')
          : state === 'failed'
            ? t('invoices.pdf.renderAgain')
            : t('invoices.statement.preparePdf')}
      </Button>
      <span role="status" className="sr-only">
        {preparing ? t('invoices.statement.preparing') : ''}
      </span>
    </span>
  );
}
