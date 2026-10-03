import type { InvoiceDetail, Payment } from '@vertex-hub/contracts';
import { Badge, Button, toast } from '@vertex-hub/ui';
import { DownloadIcon, FileTextIcon, LoaderCircleIcon, RefreshCwIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import {
  invoicePdfUrl,
  receiptPdfUrl,
  useRenderInvoicePdf,
  useRenderReceipt,
} from './invoices.queries';

/** Asks for a render: the draft's preview, or an issued invoice again after a failure. */
function RenderButton({ invoice, label }: { invoice: InvoiceDetail; label: string }) {
  const { t } = useTranslation();
  const render = useRenderInvoicePdf(invoice.id);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={render.isPending}
      onClick={async () => {
        try {
          await render.mutateAsync();
        } catch (error) {
          toast.add({ title: errorMessage(t, error), type: 'error' });
        }
      }}
    >
      <RefreshCwIcon />
      {label}
    </Button>
  );
}

function Preparing({ text }: { text: string }) {
  return (
    <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-none"
      />
      {text}
    </span>
  );
}

/** Rule 15: the issued invoice's PDF, "being prepared" until it exists, "render again" on failure. */
export function IssuedPdf({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  if (!invoice.pdf) return null;
  if (invoice.pdf.state === 'ready') {
    return (
      <Button
        variant="outline"
        render={<a href={invoicePdfUrl(invoice.id)} target="_blank" rel="noopener" />}
      >
        <DownloadIcon />
        {t('invoices.pdf.download')}
      </Button>
    );
  }
  if (invoice.pdf.state === 'pending') return <Preparing text={t('invoices.pdf.preparing')} />;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>
      {invoice.permissions.canRenderPdf && (
        <RenderButton invoice={invoice} label={t('invoices.pdf.renderAgain')} />
      )}
    </span>
  );
}

/**
 * The draft's preview (F04 rule 13): asking needs the saved draft (`saved`); a preview of an older
 * draft says so.
 */
export function DraftPreview({ invoice, saved }: { invoice: InvoiceDetail; saved: boolean }) {
  const { t } = useTranslation();
  const preview = invoice.draftPdf;
  const canRender = invoice.permissions.canRenderPdf && saved;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <FileTextIcon aria-hidden="true" className="size-5 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{t('invoices.pdf.previewTitle')}</span>
        <span className="text-sm text-muted-foreground">
          {!saved && invoice.permissions.canRenderPdf
            ? t('invoices.pdf.saveFirst')
            : preview?.state === 'ready' && preview.renderedAt
              ? t('invoices.pdf.previewRendered', { when: formatDateTime(preview.renderedAt) })
              : t('invoices.pdf.previewHint')}
        </span>
      </div>
      {preview?.state === 'pending' && <Preparing text={t('invoices.pdf.preparingPreview')} />}
      {preview?.state === 'failed' && <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>}
      {preview?.state === 'ready' && (
        <>
          {preview.outdated && <Badge tone="warning">{t('invoices.pdf.outdated')}</Badge>}
          <Button
            variant="outline"
            size="sm"
            render={<a href={invoicePdfUrl(invoice.id, true)} target="_blank" rel="noopener" />}
          >
            <DownloadIcon />
            {t('invoices.pdf.openPreview')}
          </Button>
        </>
      )}
      {canRender && preview?.state !== 'pending' && (
        <RenderButton invoice={invoice} label={t('invoices.pdf.preview')} />
      )}
    </div>
  );
}

/** Rule 20: a payment's receipt, with "render again" after a failure. */
export function ReceiptPdf({ invoice, payment }: { invoice: InvoiceDetail; payment: Payment }) {
  const { t } = useTranslation();
  const render = useRenderReceipt(invoice.id);
  if (!payment.receiptPdf) return null;
  if (payment.receiptPdf.state === 'ready') {
    return (
      <Button
        variant="ghost"
        size="sm"
        render={<a href={receiptPdfUrl(payment.id)} target="_blank" rel="noopener" />}
        aria-label={t('invoices.payments.receiptOf', { number: payment.receiptNumber })}
      >
        <DownloadIcon />
        {t('invoices.payments.receipt')}
      </Button>
    );
  }
  if (payment.receiptPdf.state === 'pending') {
    return <Preparing text={t('invoices.pdf.preparingReceipt')} />;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone="danger">{t('invoices.pdf.failed')}</Badge>
      <Button
        variant="outline"
        size="sm"
        disabled={render.isPending}
        onClick={async () => {
          try {
            await render.mutateAsync(payment.id);
          } catch (error) {
            toast.add({ title: errorMessage(t, error), type: 'error' });
          }
        }}
      >
        <RefreshCwIcon />
        {t('invoices.pdf.renderAgain')}
      </Button>
    </span>
  );
}
