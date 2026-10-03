import type { InvoiceOrigin, InvoiceStatus } from '@vertex-hub/contracts';
import { Badge } from '@vertex-hub/ui';
import { ArchiveIcon, ClockAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';

/** Open invoices in the workflow colors; paid takes Vertex Green, like delivered work. */
const statusTone = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'gold',
  paid: 'brand',
  overdue: 'danger',
  void: 'outline',
} as const;

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]} data-status={status}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`invoices.statuses.${status}`)}
    </Badge>
  );
}

/** How the draft started: from a quote, a milestone, a monthly cycle, or by hand. */
export function OriginBadge({ origin }: { origin: InvoiceOrigin }) {
  const { t } = useTranslation();
  return <Badge tone="outline">{t(`invoices.origins.${origin}`)}</Badge>;
}

export function DaysOverdueBadge({ days }: { days: number }) {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <ClockAlertIcon aria-hidden="true" />
      {t('invoices.daysOverdue', { count: days, n: formatNumber(days) })}
    </Badge>
  );
}

export function DiscardedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral">
      <ArchiveIcon aria-hidden="true" />
      {t('invoices.discardedBadge')}
    </Badge>
  );
}
