import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { InvoiceDetail, InvoiceSettings, Payment } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Callout,
  Card,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  BanIcon,
  BanknoteIcon,
  CalendarClockIcon,
  FileTextIcon,
  FolderKanbanIcon,
  ListTreeIcon,
  PaperclipIcon,
  RepeatIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { Money } from '../quotes/quote-badges';
import {
  DaysOverdueBadge,
  DiscardedBadge,
  InvoiceStatusBadge,
  OriginBadge,
} from './invoice-badges';
import {
  DueDateDialog,
  PaymentDialog,
  VoidInvoiceDialog,
  VoidPaymentDialog,
} from './invoice-dialogs';
import { InvoiceEditor } from './invoice-editor';
import { IssuedPdf, ReceiptPdf } from './invoice-pdf';
import { invoiceQuery, invoiceSettingsQuery } from './invoices.queries';
import { LineService, ServicesDialog } from './line-services';
import { SourceChip } from './source-chip';

/** Spec screens 2 and 3: the editor while a draft, the issued invoice with its payments after. */
export function InvoicePage({ invoiceId }: { invoiceId: string }) {
  const { t } = useTranslation();
  const invoice = useQuery(invoiceQuery(invoiceId));
  const settings = useQuery(invoiceSettingsQuery);
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/invoices" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('invoices.back')}
        </Button>
      </div>
      {invoice.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
      ) : invoice.isError ? (
        <LoadError
          message={isMissing(invoice.error) ? t('invoices.notFound') : t('invoices.loadOneError')}
          onRetry={() => invoice.refetch()}
          error={invoice.error}
        />
      ) : (
        <>
          <InvoiceHeader invoice={invoice.data} />
          {invoice.data.status === 'draft' ? (
            <InvoiceEditor invoice={invoice.data} settings={settings.data} />
          ) : (
            <IssuedInvoice invoice={invoice.data} settings={settings.data} />
          )}
        </>
      )}
    </>
  );
}

function InvoiceHeader({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  const { engagement } = invoice;
  return (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          {invoice.displayNumber ? (
            <span dir="ltr" className="tabular-nums">
              {invoice.displayNumber}
            </span>
          ) : (
            t('invoices.draftTitle')
          )}
          <InvoiceStatusBadge status={invoice.status} />
          <OriginBadge origin={invoice.origin} />
          {invoice.archivedAt && <DiscardedBadge />}
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            to="/clients/$clientId"
            params={{ clientId: invoice.client.id }}
            className="hover:underline"
          >
            {invoice.client.name}
          </Link>
          {invoice.billingName !== invoice.client.name && (
            <span>{t('invoices.billedTo', { name: invoice.billingName })}</span>
          )}
          <span>{t(`invoices.currencies.${invoice.currency}`)}</span>
          {engagement?.type === 'project' && (
            <Link
              to="/projects/$projectId"
              params={{ projectId: engagement.id }}
              className="flex items-center gap-1 hover:underline"
            >
              <FolderKanbanIcon aria-hidden="true" className="size-4" />
              {engagement.name}
            </Link>
          )}
          {engagement?.type === 'retainer' && (
            <Link
              to="/retainers/$retainerId"
              params={{ retainerId: engagement.id }}
              className="flex items-center gap-1 hover:underline"
            >
              <RepeatIcon aria-hidden="true" className="size-4" />
              {engagement.name}
            </Link>
          )}
          {invoice.quote && (
            <Link
              to="/quotes/$quoteId"
              params={{ quoteId: invoice.quote.id }}
              className="flex items-center gap-1 hover:underline"
            >
              <FileTextIcon aria-hidden="true" className="size-4" />
              <span dir="ltr">{invoice.quote.displayNumber}</span>
            </Link>
          )}
        </span>
      }
    />
  );
}

/** An issued invoice: immutable but for its due date, payments and voiding (rule 12). */
function IssuedInvoice({
  invoice,
  settings,
}: {
  invoice: InvoiceDetail;
  settings: InvoiceSettings | undefined;
}) {
  const { t } = useTranslation();
  const manages = can(useMe(), 'invoices.manage');
  const [open, setOpen] = useState<'payment' | 'dueDate' | 'services' | 'void' | null>(null);
  const [voidingPayment, setVoidingPayment] = useState<Payment | null>(null);
  const { permissions } = invoice;
  const livePayments = invoice.payments.some((payment) => !payment.voided);
  // Rule 14: void is offered on sent and overdue invoices, and waits for their payments' voids.
  const blockedVoid =
    manages &&
    livePayments &&
    ['sent', 'partially_paid', 'paid', 'overdue'].includes(invoice.status);

  return (
    <>
      {invoice.voided && (
        <Callout
          tone="danger"
          icon={<BanIcon />}
          title={t('invoices.voidedTitle', {
            name: invoice.voided.by.name,
            when: formatDateTime(invoice.voided.at),
          })}
          description={invoice.voided.reason}
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <IssuedPdf invoice={invoice} />
        {permissions.canRecordPayment && (
          <Button onClick={() => setOpen('payment')}>
            <BanknoteIcon />
            {t('invoices.payments.action')}
          </Button>
        )}
        {permissions.canChangeDueDate && (
          <Button variant="outline" onClick={() => setOpen('dueDate')}>
            <CalendarClockIcon />
            {t('invoices.dueDate.action')}
          </Button>
        )}
        {permissions.canEditServices && (
          <Button variant="outline" onClick={() => setOpen('services')}>
            <ListTreeIcon />
            {t('invoices.services.action')}
          </Button>
        )}
        {(permissions.canVoid || blockedVoid) && (
          <Button
            variant="ghost"
            className="ms-auto"
            disabled={!permissions.canVoid}
            onClick={() => setOpen('void')}
          >
            <BanIcon />
            {t('invoices.void.action')}
          </Button>
        )}
        {blockedVoid && !permissions.canVoid && (
          <p className="text-sm text-muted-foreground">{t('invoices.void.blocked')}</p>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <LinesCard invoice={invoice} />
          <PaymentsCard
            invoice={invoice}
            onVoid={permissions.canVoidPayments ? setVoidingPayment : undefined}
          />
          {invoice.notes && (
            <Card className="gap-2 p-6">
              <h2 className="font-bold">{t('invoices.editor.notes')}</h2>
              <p className="text-sm whitespace-pre-line">{invoice.notes}</p>
            </Card>
          )}
        </div>
        <aside>
          <Facts invoice={invoice} showUsd={manages} />
        </aside>
      </div>

      <PaymentDialog
        invoice={invoice}
        settings={settings}
        open={open === 'payment'}
        onClose={() => setOpen(null)}
      />
      <DueDateDialog
        key={invoice.dueOn}
        invoice={invoice}
        open={open === 'dueDate'}
        onClose={() => setOpen(null)}
      />
      {permissions.canEditServices && (
        <ServicesDialog
          key={invoice.lines.map((line) => line.service?.id ?? '').join()}
          invoice={invoice}
          open={open === 'services'}
          onClose={() => setOpen(null)}
        />
      )}
      <VoidInvoiceDialog invoice={invoice} open={open === 'void'} onClose={() => setOpen(null)} />
      <VoidPaymentDialog payment={voidingPayment} onClose={() => setVoidingPayment(null)} />
    </>
  );
}

function LinesCard({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  return (
    <Card className="gap-4 p-6">
      <h2 className="text-lg font-bold">{t('invoices.editor.lines')}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('invoices.editor.description')}</TableHead>
            <TableHead>{t('invoices.editor.service')}</TableHead>
            <TableHead className="text-end">{t('invoices.editor.quantity')}</TableHead>
            <TableHead className="text-end">{t('invoices.editor.unitPrice')}</TableHead>
            <TableHead className="text-end">{t('invoices.lineTotal')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoice.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="whitespace-normal">
                <span className="flex flex-col items-start gap-1">
                  <span className="font-medium">{line.description}</span>
                  {line.source && <SourceChip source={line.source} />}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <LineService service={line.service} />
              </TableCell>
              <TableCell className="text-end tabular-nums">{formatNumber(line.quantity)}</TableCell>
              <TableCell className="text-end">
                <Money minor={line.unitPriceMinor} currency={invoice.currency} />
              </TableCell>
              <TableCell className="text-end">
                <Money minor={line.totalMinor} currency={invoice.currency} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="flex items-baseline justify-between gap-3 border-t border-border pt-4">
        <span className="font-bold">{t('invoices.facts.total')}</span>
        <Money
          minor={invoice.totalMinor}
          currency={invoice.currency}
          className="text-lg font-bold"
        />
      </p>
    </Card>
  );
}

function PaymentsCard({
  invoice,
  onVoid,
}: {
  invoice: InvoiceDetail;
  onVoid?: (payment: Payment) => void;
}) {
  const { t } = useTranslation();
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <Card className="gap-4 p-6">
      <h2 className="text-lg font-bold">{t('invoices.payments.heading')}</h2>
      {invoice.payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('invoices.payments.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('invoices.payments.columns.receipt')}</TableHead>
              <TableHead>{t('invoices.payments.columns.date')}</TableHead>
              <TableHead className="text-end">{t('invoices.payments.columns.amount')}</TableHead>
              <TableHead className="text-end">{t('invoices.payments.columns.applied')}</TableHead>
              <TableHead>{t('invoices.payments.columns.method')}</TableHead>
              <TableHead>{t('invoices.payments.columns.recordedBy')}</TableHead>
              <TableHead>{t('invoices.payments.columns.documents')}</TableHead>
              {onVoid && (
                <TableHead>
                  <span className="sr-only">{t('invoices.payments.columns.actions')}</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.payments.map((payment) => (
              <TableRow key={payment.id} className={payment.voided ? 'text-muted-foreground' : ''}>
                <TableCell>
                  <span className="flex flex-col items-start gap-1">
                    <span dir="ltr" className="tabular-nums">
                      {payment.receiptNumber}
                    </span>
                    {payment.voided && (
                      <Badge tone="outline">{t('invoices.payments.voidedBadge')}</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>{formatCalendarDate(payment.paidOn)}</TableCell>
                <TableCell className="text-end">
                  <span className="flex flex-col items-end">
                    <Money minor={payment.amountMinor} currency={payment.currency} />
                    {payment.currency !== invoice.currency && (
                      <span className="text-xs text-muted-foreground">
                        {t('invoices.payments.atRate', { rate: payment.sypPerUsd })}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-end">
                  <Money minor={payment.appliedMinor} currency={invoice.currency} />
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-col">
                    <span>{t(`invoices.methods.${payment.method}`)}</span>
                    {payment.reference && (
                      <span className="text-xs text-muted-foreground" dir="auto">
                        {payment.reference}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="whitespace-normal">
                  <span className="flex flex-col">
                    <span>{payment.recordedBy.name}</span>
                    {payment.voided && (
                      <span className="text-xs">
                        {t('invoices.payments.voidedBy', {
                          name: payment.voided.by.name,
                          reason: payment.voided.reason,
                        })}
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1">
                    <ReceiptPdf invoice={invoice} payment={payment} />
                    {payment.proof ? (
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: invoice.client.id }}
                        search={{ tab: 'files' }}
                        className="flex items-center gap-1 text-sm hover:underline"
                      >
                        <PaperclipIcon aria-hidden="true" className="size-4" />
                        <span dir="auto">{payment.proof.name}</span>
                      </Link>
                    ) : (
                      !payment.receiptPdf && none
                    )}
                  </span>
                </TableCell>
                {onVoid && (
                  <TableCell>
                    {!payment.voided && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('invoices.voidPayment.actionOf', {
                          number: payment.receiptNumber,
                        })}
                        onClick={() => onVoid(payment)}
                      >
                        <BanIcon />
                        {t('invoices.voidPayment.action')}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

/** The invoice's dates and money, with USD equivalents at its rate for managers. */
function Facts({ invoice, showUsd }: { invoice: InvoiceDetail; showUsd: boolean }) {
  const { t } = useTranslation();
  const usd = showUsd && invoice.currency !== 'USD' ? invoice.usd : null;
  const amount = (minor: number, usdMinor: number | undefined) => (
    <span className="flex flex-col items-end">
      <Money minor={minor} currency={invoice.currency} />
      {usdMinor !== undefined && (
        <Money minor={usdMinor} currency="USD" className="text-xs text-muted-foreground" />
      )}
    </span>
  );
  return (
    <Card className="gap-3 p-5">
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
        {invoice.issuedOn && (
          <>
            <dt className="text-muted-foreground">{t('invoices.facts.issued')}</dt>
            <dd className="text-end">{formatCalendarDate(invoice.issuedOn)}</dd>
          </>
        )}
        {invoice.dueOn && (
          <>
            <dt className="text-muted-foreground">{t('invoices.facts.due')}</dt>
            <dd className="flex flex-col items-end gap-1">
              {formatCalendarDate(invoice.dueOn)}
              {invoice.daysOverdue !== null && <DaysOverdueBadge days={invoice.daysOverdue} />}
            </dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('invoices.facts.total')}</dt>
        <dd>{amount(invoice.totalMinor, usd?.totalMinor)}</dd>
        <dt className="text-muted-foreground">{t('invoices.facts.paid')}</dt>
        <dd>{amount(invoice.paidMinor, usd?.paidMinor)}</dd>
        <dt className="font-bold">{t('invoices.facts.balance')}</dt>
        <dd className="font-bold">{amount(invoice.balanceMinor, usd?.balanceMinor)}</dd>
        {invoice.sypPerUsd && (
          <>
            <dt className="text-muted-foreground">{t('invoices.rate.label')}</dt>
            <dd className="text-end">
              <span dir="ltr" className="tabular-nums">
                {invoice.sypPerUsd}
              </span>
            </dd>
          </>
        )}
        {invoice.issuedBy && (
          <>
            <dt className="text-muted-foreground">{t('invoices.facts.issuedBy')}</dt>
            <dd className="text-end">{invoice.issuedBy.name}</dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('invoices.facts.accountManager')}</dt>
        <dd className="text-end">{invoice.accountManager.name}</dd>
      </dl>
    </Card>
  );
}
