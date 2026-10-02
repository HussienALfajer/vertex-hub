import type { Currency, DiscountApproval, QuoteStatus } from '@vertex-hub/contracts';
import { Badge, cn } from '@vertex-hub/ui';
import { ArchiveIcon, HourglassIcon, StampIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';

/** Open quotes in the workflow colors; accepted takes Vertex Green, like delivered work. */
const statusTone = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'brand',
  rejected: 'danger',
  expired: 'warning',
  superseded: 'outline',
} as const;

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]} data-status={status}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`quotes.statuses.${status}`)}
    </Badge>
  );
}

/** Shown only while the discount approval says something: awaiting, approved or returned. */
export function ApprovalBadge({ approval }: { approval: DiscountApproval }) {
  const { t } = useTranslation();
  if (approval === 'none') return null;
  const tone = approval === 'pending' ? 'gold' : approval === 'approved' ? 'success' : 'warning';
  return (
    <Badge tone={tone}>
      <StampIcon aria-hidden="true" />
      {t(`quotes.approvals.${approval}`)}
    </Badge>
  );
}

export function ExpiresSoonBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="warning">
      <HourglassIcon aria-hidden="true" />
      {t('quotes.expiresSoon')}
    </Badge>
  );
}

export function DiscardedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="neutral">
      <ArchiveIcon aria-hidden="true" />
      {t('quotes.discardedBadge')}
    </Badge>
  );
}

/** An amount in its currency, read left to right inside Arabic text. */
export function Money({
  minor,
  currency,
  className,
}: {
  minor: number;
  currency: Currency;
  className?: string;
}) {
  return (
    <span dir="ltr" className={cn('tabular-nums', className)}>
      {formatMoney(minor, currency)}
    </span>
  );
}

/** Basis points as a percentage with two decimals, e.g. `12.50%`. */
export function formatBasisPoints(basisPoints: number): string {
  return formatNumber(basisPoints / 10000, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
