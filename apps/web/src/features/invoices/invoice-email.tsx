import {
  businessDate,
  type ClientStatement,
  type ClientStatementQuery,
  daysInclusive,
  type InvoiceDetail,
  type Payment,
} from '@vertex-hub/contracts';
import { Button } from '@vertex-hub/ui';
import { BellRingIcon, MailIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, useMe } from '../../lib/auth';
import { SendEmailDialog } from '../email/send-email-dialog';

const EMAILED = ['sent', 'partially_paid', 'overdue', 'paid'];

/**
 * F14 email rule 18: an issued invoice is emailed with its PDF by `invoices.send` holders, and an
 * overdue one reminded. Cosmetic: the API checks the client's scope.
 */
export function InvoiceEmailActions({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const [kind, setKind] = useState<'invoice' | 'overdue_reminder' | null>(null);
  const { displayNumber, issuedOn, dueOn } = invoice;
  if (!can(me, 'invoices.send') || !EMAILED.includes(invoice.status)) return null;
  if (!displayNumber || !issuedOn || !dueOn) return null;
  const facts = {
    invoice: {
      number: displayNumber,
      issuedOn,
      dueOn,
      total: { amountMinor: invoice.totalMinor, currency: invoice.currency },
      balance: { amountMinor: invoice.balanceMinor, currency: invoice.currency },
    },
  };
  return (
    <>
      <Button variant="outline" onClick={() => setKind('invoice')}>
        <MailIcon />
        {t('email.send.action')}
      </Button>
      {invoice.status === 'overdue' && (
        <Button variant="outline" onClick={() => setKind('overdue_reminder')}>
          <BellRingIcon />
          {t('invoices.email.reminder')}
        </Button>
      )}
      <SendEmailDialog
        open={kind !== null}
        onClose={() => setKind(null)}
        clientId={invoice.client.id}
        target={{ type: 'invoice', id: invoice.id, kind: kind ?? 'invoice' }}
        draft={
          kind === 'overdue_reminder'
            ? {
                kind: 'client_invoice_reminder',
                data: {
                  ...facts,
                  daysOverdue: Math.max(1, daysInclusive(dueOn, businessDate()) - 1),
                },
              }
            : { kind: 'client_invoice', data: facts }
        }
        attachment={{ fileName: `${displayNumber}.pdf`, ready: invoice.pdf?.state === 'ready' }}
      />
    </>
  );
}

/** Rule 18: the receipt of a payment that is not voided, with its PDF. */
export function ReceiptEmailButton({
  invoice,
  payment,
}: {
  invoice: InvoiceDetail;
  payment: Payment;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!can(me, 'invoices.send') || payment.voided || !payment.receiptPdf) return null;
  if (!invoice.displayNumber) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('invoices.email.receiptOf', { number: payment.receiptNumber })}
        onClick={() => setOpen(true)}
      >
        <MailIcon />
      </Button>
      <SendEmailDialog
        open={open}
        onClose={() => setOpen(false)}
        clientId={invoice.client.id}
        target={{ type: 'payment', id: payment.id }}
        draft={{
          kind: 'client_receipt',
          data: {
            invoiceId: invoice.id,
            receipt: {
              number: payment.receiptNumber,
              invoiceNumber: invoice.displayNumber,
              paidOn: payment.paidOn,
              amount: { amountMinor: payment.amountMinor, currency: payment.currency },
            },
          },
        }}
        attachment={{
          fileName: `${payment.receiptNumber}.pdf`,
          ready: payment.receiptPdf.state === 'ready',
        }}
      />
    </>
  );
}

/** Rule 21: a statement whose PDF is ready, as it is now; the email keeps a copy of the PDF. */
export function StatementEmailButton({
  clientId,
  query,
  statement,
}: {
  clientId: string;
  query: ClientStatementQuery;
  statement: ClientStatement;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (!can(me, 'invoices.send')) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <MailIcon />
        {t('email.send.action')}
      </Button>
      <SendEmailDialog
        open={open}
        onClose={() => setOpen(false)}
        clientId={clientId}
        target={{ type: 'statement', clientId, ...query }}
        draft={{
          kind: 'client_statement',
          data: {
            statement: {
              currency: statement.currency,
              from: statement.from,
              to: statement.to,
              outstandingMinor: statement.outstandingMinor,
            },
          },
        }}
        attachment={{
          fileName: `${statement.client.name} - Statement ${statement.currency} ${statement.from} ${statement.to}.pdf`,
          ready: true,
        }}
      />
    </>
  );
}
