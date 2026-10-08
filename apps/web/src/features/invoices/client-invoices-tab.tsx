import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  type ClientBilling,
  type ClientDetailResponse,
  type UpdateClient,
  updateClientSchema,
} from '@vertex-hub/contracts';
import {
  Button,
  Card,
  EmptyState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { ArrowLeftIcon, PencilIcon, PlusIcon, ReceiptTextIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { useUpdateClient } from '../clients/clients.queries';
import { EmailHistory } from '../email/email-history';
import { Money } from '../quotes/quote-badges';
import { FormDialog } from '../quotes/quote-dialogs';
import { clientBillingQuery, invoicesKeys } from './invoices.queries';
import { InvoicesTable, TableSkeleton } from './invoices-page';
import { NewInvoiceDialog } from './new-invoice-dialog';
import { BillingSection } from './project-billing-tab';
import { StatementSection } from './statement-section';

/**
 * Spec screen 5: the client's money for invoice readers covering it — billing details, balances
 * per currency, the latest invoices and the statement.
 */
export function ClientInvoicesTab({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const me = useMe();
  const billing = useQuery(clientBillingQuery(client.id));
  const [creating, setCreating] = useState(false);
  // Archived clients get no new invoices (rule 1).
  const canCreate = can(me, 'invoices.manage') && client.archivedAt === null;

  return (
    <div className="flex flex-col gap-6">
      <BillingDetails client={client} />
      {billing.isPending ? (
        <div className="flex flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
          <TableSkeleton />
        </div>
      ) : billing.isError ? (
        <LoadError
          message={t('invoices.billing.loadError')}
          onRetry={() => billing.refetch()}
          error={billing.error}
        />
      ) : (
        <>
          <Balances billing={billing.data} />
          <BillingSection
            title={t('invoices.client.latest')}
            action={
              <div className="flex flex-wrap items-center gap-2">
                {billing.data.latest.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    render={<Link to="/invoices" search={{ tab: 'all', clientId: client.id }} />}
                  >
                    {t('invoices.client.all')}
                    <ArrowLeftIcon className="ltr:-scale-x-100" />
                  </Button>
                )}
                {canCreate && (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <PlusIcon />
                    {t('invoices.new.action')}
                  </Button>
                )}
              </div>
            }
          >
            {billing.data.latest.length === 0 ? (
              <EmptyState
                icon={<ReceiptTextIcon />}
                title={t('invoices.client.empty')}
                description={t('invoices.client.emptyHint')}
              />
            ) : (
              <InvoicesTable invoices={billing.data.latest} showClient={false} />
            )}
          </BillingSection>
          <StatementSection
            clientId={client.id}
            currencies={billing.data.byCurrency.map((row) => row.currency)}
          />
          <EmailHistory target={{ type: 'statement', clientId: client.id }} />
        </>
      )}
      {canCreate && (
        <NewInvoiceDialog open={creating} onClose={() => setCreating(false)} clientId={client.id} />
      )}
    </div>
  );
}

/** Invoiced, paid, outstanding and overdue per currency, over the issued, non-void invoices. */
function Balances({ billing }: { billing: ClientBilling }) {
  const { t } = useTranslation();
  if (billing.byCurrency.length === 0) return null;
  return (
    <section aria-label={t('invoices.client.balances')} className="grid gap-3 sm:grid-cols-2">
      {billing.byCurrency.map((row) => (
        <Card key={row.currency} className="gap-2 p-4">
          <h2 className="text-sm text-muted-foreground">
            {t(`invoices.totals.currency.${row.currency}`)}
          </h2>
          <Line label={t('invoices.client.invoiced')}>
            <Money minor={row.invoicedMinor} currency={row.currency} />
          </Line>
          <Line label={t('invoices.client.paid')}>
            <Money minor={row.paidMinor} currency={row.currency} />
          </Line>
          <Line label={t('invoices.totals.outstanding')}>
            <Money minor={row.outstandingMinor} currency={row.currency} className="font-bold" />
          </Line>
          <Line label={t('invoices.totals.overdue')}>
            <Money
              minor={row.overdueMinor}
              currency={row.currency}
              className={row.overdueMinor > 0 ? 'text-destructive-text' : undefined}
            />
          </Line>
        </Card>
      ))}
    </section>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex items-baseline justify-between gap-3 text-sm">
      <span>{label}</span>
      {children}
    </p>
  );
}

interface BillingValues {
  billingName: string;
  billingAddress: string;
}

/**
 * The name and address printed on the client's invoices, receipts and statements (F13, F02's
 * `PATCH`); editable with `clients.manage` covering the client, like the client's basics.
 */
function BillingDetails({ client }: { client: ClientDetailResponse }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const update = useUpdateClient(client.id);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const defaults: BillingValues = {
    billingName: client.billingName ?? '',
    billingAddress: client.billingAddress ?? '',
  };
  const form = useForm<BillingValues>({
    values: defaults,
    // A refetch keeps what the user already changed.
    resetOptions: { keepDirtyValues: true },
  });
  const { errors } = form.formState;
  const editable = client.canManage && client.archivedAt === null;

  function close() {
    setOpen(false);
  }

  // Back to the latest saved details once it has faded out (after a save, `values` holds the new
  // ones); without `keepDirtyValues`, which would keep the unsaved text for the next opening.
  function closed() {
    setFailure(null);
    form.reset(defaults, { keepDirtyValues: false });
  }

  const submit = form.handleSubmit(async (values) => {
    setFailure(null);
    const checked = updateClientSchema.safeParse({
      billingName: values.billingName.trim() || null,
      billingAddress: values.billingAddress.trim() || null,
    });
    if (!checked.success) {
      for (const issue of checked.error.issues) {
        form.setError(issue.path.join('.') as keyof BillingValues, { type: 'schema' });
      }
      return;
    }
    try {
      await update.mutateAsync(checked.data satisfies UpdateClient);
      // Statements print the billing details.
      await queryClient.invalidateQueries({ queryKey: invoicesKeys.all });
      toast.add({ title: t('invoices.client.billingSaved'), type: 'success' });
      close();
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  });

  return (
    <Card className="flex-row flex-wrap items-start gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 className="text-sm text-muted-foreground">{t('invoices.client.billingDetails')}</h2>
        <p className="font-medium">{client.billingName ?? client.tradeName}</p>
        {client.billingAddress ? (
          <p className="whitespace-pre-line text-sm">{client.billingAddress}</p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('invoices.client.noAddress')}</p>
        )}
        {!client.billingName && (
          <p className="text-xs text-muted-foreground">{t('invoices.client.tradeNameUsed')}</p>
        )}
      </div>
      {editable && (
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <PencilIcon />
          {t('invoices.client.editBilling')}
        </Button>
      )}
      <FormDialog
        open={open}
        onClose={close}
        onClosed={closed}
        submitting={form.formState.isSubmitting}
        title={t('invoices.client.billingTitle')}
        description={t('invoices.client.billingHint')}
        action={t('common.save')}
        failure={failure}
        onSubmit={submit}
      >
        <Field invalid={!!errors.billingName}>
          <FieldLabel>{t('invoices.client.billingName')}</FieldLabel>
          <Input autoComplete="off" {...form.register('billingName')} />
          <FieldDescription>{t('invoices.client.billingNameHint')}</FieldDescription>
          <FieldError match={!!errors.billingName}>
            {t('invoices.client.errors.billingName')}
          </FieldError>
        </Field>
        <Field invalid={!!errors.billingAddress}>
          <FieldLabel>{t('invoices.client.billingAddress')}</FieldLabel>
          <Textarea rows={3} {...form.register('billingAddress')} />
          <FieldError match={!!errors.billingAddress}>
            {t('invoices.client.errors.billingAddress')}
          </FieldError>
        </Field>
      </FormDialog>
    </Card>
  );
}
