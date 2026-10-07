import { useQuery } from '@tanstack/react-query';
import type { RetainerBilling, RetainerDetail } from '@vertex-hub/contracts';
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@vertex-hub/ui';
import { ReceiptTextIcon, SparklesIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatMonth } from '../../lib/format';
import { BillingBadge } from '../projects/extra-work-tab';
import { Money } from '../quotes/quote-badges';
import { retainerBillingQuery } from './invoices.queries';
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
                  <TableCell className="font-medium">{formatMonth(charge.month)}</TableCell>
                  <TableCell>{t(`retainers.chargeKinds.${charge.kind}`)}</TableCell>
                  <TableCell className="text-end">
                    <Money minor={charge.amountMinor} currency={currency} />
                  </TableCell>
                  <TableCell>
                    {charge.status !== 'pending' ? (
                      <span className="text-muted-foreground">
                        {t(`retainers.chargeStatuses.${charge.status}`)}
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
                        <CreateFromSource
                          clientId={clientId}
                          currency={currency}
                          source={{ type: 'retainer_charge', id: charge.id }}
                          name={formatMonth(charge.month)}
                        />
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
