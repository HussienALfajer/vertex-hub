import { useQuery } from '@tanstack/react-query';
import type { RetainerBilling, RetainerCharge, RetainerDetail } from '@vertex-hub/contracts';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldLabel,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from '@vertex-hub/ui';
import { HandCoinsIcon, ReceiptTextIcon, SparklesIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatMonth, formatNumber } from '../../lib/format';
import { BillingBadge } from '../projects/extra-work-tab';
import { Money } from '../quotes/quote-badges';
import { retainerBillingQuery, useSettleCharge } from './invoices.queries';
import { InvoicesTable } from './invoices-page';
import { BillingSection, BillingSkeleton } from './project-billing-tab';
import { CreateFromSource, SourceInvoiceCell } from './source-invoice';

/**
 * Spec screen 7: the retainer's money for money access — each charge by month with its invoice
 * (F05B screen 5), the extra work with the invoice that bills it, and the retainer's invoices.
 */
export function RetainerBillingTab({ retainer }: { retainer: RetainerDetail }) {
  const { t } = useTranslation();
  const billing = useQuery(retainerBillingQuery(retainer.id));
  if (billing.isPending) return <BillingSkeleton />;
  if (billing.isError) {
    return (
      <LoadError
        message={t('invoices.billing.loadError')}
        onRetry={() => billing.refetch()}
        error={billing.error}
      />
    );
  }
  return <RetainerBillingView billing={billing.data} clientId={retainer.client.id} />;
}

function RetainerBillingView({
  billing,
  clientId,
}: {
  billing: RetainerBilling;
  clientId: string;
}) {
  const { t } = useTranslation();
  const me = useMe();
  // Archived retainers give no new drafts (rule 1); the API refuses them too.
  const canInvoice = can(me, 'invoices.manage') && !billing.retainer.archived;
  const { currency } = billing.retainer;
  const none = <span className="text-muted-foreground">{t('common.none')}</span>;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {t('invoices.billing.monthlyFee')}{' '}
        {billing.retainer.monthlyFeeMinor !== null ? (
          <Money minor={billing.retainer.monthlyFeeMinor} currency={currency} />
        ) : (
          t('invoices.billing.noFee')
        )}
      </p>

      <BillingSection title={t('invoices.billing.charges')}>
        {billing.charges.length === 0 ? (
          <EmptyState
            icon={<ReceiptTextIcon />}
            title={t('invoices.billing.noCharges')}
            description={t('invoices.billing.noChargesHint')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('invoices.billing.month')}</TableHead>
                <TableHead>{t('invoices.billing.chargeKind')}</TableHead>
                <TableHead className="text-end">{t('invoices.billing.amount')}</TableHead>
                <TableHead>{t('invoices.billing.invoice')}</TableHead>
                {canInvoice && (
                  <TableHead>
                    <span className="sr-only">{t('invoices.billing.actions')}</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.charges.map((charge) => (
                <TableRow key={charge.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium">{formatMonth(charge.month)}</span>
                      {charge.term && (
                        <span className="text-xs text-muted-foreground">
                          {t('retainers.terms.name', { number: formatNumber(charge.term.number) })}
                          {' · '}
                          {t('retainers.terms.position', {
                            position: formatNumber(charge.term.position),
                            months: formatNumber(charge.term.months),
                          })}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col">
                      <span>{t(`retainers.chargeKinds.${charge.kind}`)}</span>
                      {charge.amendment && (
                        <span className="text-xs text-muted-foreground">
                          {t('invoices.billing.amendment', {
                            number: formatNumber(charge.amendment.number),
                          })}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-end">
                    <Money minor={charge.amountMinor} currency={currency} />
                  </TableCell>
                  <TableCell>
                    {charge.status !== 'pending' ? (
                      <span className="flex flex-col text-muted-foreground">
                        <span>{t(`retainers.chargeStatuses.${charge.status}`)}</span>
                        {charge.settleNote && (
                          <span className="text-xs whitespace-normal">{charge.settleNote}</span>
                        )}
                      </span>
                    ) : charge.kind === 'credit' && charge.due && !charge.invoice ? (
                      <span className="font-medium text-status-gold-foreground">
                        {t('invoices.billing.creditOwed')}
                      </span>
                    ) : !charge.due ? (
                      <span className="text-muted-foreground">{t('invoices.billing.notDue')}</span>
                    ) : (
                      <SourceInvoiceCell invoice={charge.invoice} />
                    )}
                  </TableCell>
                  {canInvoice && (
                    <TableCell className="text-end">
                      {!charge.invoice && charge.due && charge.status === 'pending' && (
                        <span className="flex flex-wrap justify-end gap-2">
                          {/* A credit alone cannot be an invoice (C9): it joins a manual one. */}
                          {charge.kind !== 'credit' && (
                            <CreateFromSource
                              clientId={clientId}
                              currency={currency}
                              source={{ type: 'retainer_charge', id: charge.id }}
                              name={formatMonth(charge.month)}
                            />
                          )}
                          {charge.kind === 'credit' && billing.canSettleCredits && (
                            <SettleDialog retainerId={billing.retainer.id} charge={charge} />
                          )}
                        </span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BillingSection>

      <BillingSection title={t('invoices.billing.extraWork')}>
        {billing.extraWork.length === 0 ? (
          <EmptyState
            icon={<SparklesIcon />}
            title={t('invoices.billing.noExtraWork')}
            description={t('invoices.billing.noExtraWorkHint')}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('invoices.billing.extraWorkTitle')}</TableHead>
                <TableHead>{t('invoices.billing.billingStatus')}</TableHead>
                <TableHead className="text-end">{t('invoices.billing.estimate')}</TableHead>
                <TableHead>{t('invoices.billing.invoice')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {billing.extraWork.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal font-medium">{item.title}</TableCell>
                  <TableCell>
                    <BillingBadge status={item.billingStatus} />
                  </TableCell>
                  <TableCell className="text-end">
                    {item.estimateMinor !== null ? (
                      <Money minor={item.estimateMinor} currency={currency} />
                    ) : (
                      none
                    )}
                  </TableCell>
                  <TableCell>
                    <SourceInvoiceCell invoice={item.invoice} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BillingSection>

      <BillingSection title={t('invoices.billing.invoices')}>
        {billing.invoices.length === 0 ? (
          <EmptyState
            icon={<ReceiptTextIcon />}
            title={t('invoices.billing.noInvoices')}
            description={t('invoices.billing.noInvoicesHint')}
          />
        ) : (
          <InvoicesTable invoices={billing.invoices} showClient={false} showEngagement={false} />
        )}
      </BillingSection>
    </div>
  );
}

/** F05B C9: a pending credit refunded or settled outside the system, with a note. */
function SettleDialog({ retainerId, charge }: { retainerId: string; charge: RetainerCharge }) {
  const { t } = useTranslation();
  const id = useId();
  const settle = useSettleCharge(retainerId);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    if (!note.trim()) {
      setMissing(true);
      return;
    }
    try {
      await settle.mutateAsync({ chargeId: charge.id, note: note.trim() });
      toast.add({ title: t('invoices.billing.settled'), type: 'success' });
      setOpen(false);
    } catch (error) {
      setFailure(errorMessage(t, error));
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setNote('');
          setMissing(false);
          setFailure(null);
          setOpen(true);
        }}
      >
        <HandCoinsIcon />
        {t('invoices.billing.settle')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent closeLabel={t('common.close')}>
          <form className="grid gap-5" onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>{t('invoices.billing.settleTitle')}</DialogTitle>
              <DialogDescription>{t('invoices.billing.settleBody')}</DialogDescription>
            </DialogHeader>
            <Field invalid={missing}>
              <FieldLabel htmlFor={id}>{t('invoices.billing.settleNote')}</FieldLabel>
              <Textarea
                id={id}
                rows={2}
                maxLength={300}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setMissing(false);
                }}
              />
              <FieldError match={missing}>{t('invoices.billing.settleNoteRequired')}</FieldError>
            </Field>
            {failure && <FormAlert>{failure}</FormAlert>}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" type="button" />}>
                {t('common.cancel')}
              </DialogClose>
              <Button type="submit" disabled={settle.isPending}>
                {t('invoices.billing.settle')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
