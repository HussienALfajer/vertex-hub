import { Link, useNavigate } from '@tanstack/react-router';
import type { Currency, InvoiceSourceType, SourceInvoice } from '@vertex-hub/contracts';
import { Button, toast } from '@vertex-hub/ui';
import { FilePlusIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errors';
import { InvoiceStatusBadge } from './invoice-badges';
import { useCreateInvoice } from './invoices.queries';

/** The live invoice holding a milestone, cycle or extra work item, or "not invoiced". */
export function SourceInvoiceCell({ invoice }: { invoice: SourceInvoice | null }) {
  const { t } = useTranslation();
  if (!invoice) {
    return <span className="text-muted-foreground">{t('invoices.billing.notInvoiced')}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Link
        to="/invoices/$invoiceId"
        params={{ invoiceId: invoice.id }}
        className="rounded-sm font-medium outline-offset-2 hover:underline"
      >
        {invoice.displayNumber ? (
          <span dir="ltr" className="tabular-nums">
            {invoice.displayNumber}
          </span>
        ) : (
          t('invoices.draftNumber')
        )}
      </Link>
      {/* A draft has no number yet: its link already says "draft". */}
      {invoice.displayNumber && <InvoiceStatusBadge status={invoice.status} />}
    </span>
  );
}

/**
 * Spec screens 6 and 7: a manual draft (rule 6) holding one source at its default amount, opened
 * in the editor. The source sets the invoice's engagement.
 */
export function CreateFromSource({
  clientId,
  currency,
  source,
  name,
}: {
  clientId: string;
  currency: Currency;
  source: { type: InvoiceSourceType; id: string };
  /** What the source is called, for the button's accessible name. */
  name: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateInvoice();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={create.isPending}
      aria-label={t('invoices.billing.createFor', { name })}
      onClick={async () => {
        try {
          const invoice = await create.mutateAsync({
            clientId,
            currency,
            projectId: null,
            retainerId: null,
            sources: [source],
          });
          await navigate({ to: '/invoices/$invoiceId', params: { invoiceId: invoice.id } });
        } catch (error) {
          toast.add({ title: errorMessage(t, error), type: 'error' });
        }
      }}
    >
      <FilePlusIcon />
      {t('invoices.billing.create')}
    </Button>
  );
}
