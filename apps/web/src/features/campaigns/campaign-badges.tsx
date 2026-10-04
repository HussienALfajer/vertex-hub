import type { AdCampaignStatus, AdPlatform, ClientPlatform } from '@vertex-hub/contracts';
import { Badge, cn, Meter, PlatformMark } from '@vertex-hub/ui';
import { ClockAlertIcon, CreditCardIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { Money } from '../quotes/quote-badges';

/** Running in Vertex Green, about to run in blue, held in warning, done neutral (as tasks). */
const statusTone = {
  planned: 'info',
  active: 'brand',
  paused: 'warning',
  completed: 'neutral',
  cancelled: 'outline',
} as const;

export function CampaignStatusBadge({ status }: { status: AdCampaignStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]} data-status={status}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`campaigns.statuses.${status}`)}
    </Badge>
  );
}

/** The glyph each ad platform shares with the client's accounts; "other" has a plain link. */
const platformGlyph: Record<AdPlatform, ClientPlatform> = {
  meta: 'facebook',
  google: 'google_business',
  tiktok: 'tiktok',
  snapchat: 'snapchat',
  linkedin: 'linkedin',
  x: 'x',
  other: 'other',
};

export function PlatformName({ platform }: { platform: AdPlatform }) {
  const { t } = useTranslation();
  return (
    <span className="flex items-center gap-2">
      <PlatformMark platform={platformGlyph[platform]} size="xs" />
      {t(`campaigns.platforms.${platform}`)}
    </span>
  );
}

/** Only the exception is marked: the client pays the platform with their own card. */
export function DirectFundingBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="outline">
      <CreditCardIcon aria-hidden="true" />
      {t('campaigns.funding.client_direct')}
    </Badge>
  );
}

export function EndPassedBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="warning">
      <TriangleAlertIcon aria-hidden="true" />
      {t('campaigns.endPassed')}
    </Badge>
  );
}

/** Rule 14: an active campaign without a recent update. */
export function NoUpdateBadge({ days }: { days: number }) {
  const { t } = useTranslation();
  return (
    <Badge tone="warning">
      <ClockAlertIcon aria-hidden="true" />
      {t('campaigns.noUpdate', { count: days, n: formatNumber(days) })}
    </Badge>
  );
}

export function LowBalanceBadge() {
  const { t } = useTranslation();
  return <Badge tone="danger">{t('campaigns.wallet.lowBadge')}</Badge>;
}

/** Rule 11: the share of the budget spent, highlighted once it is used up. */
export function BudgetUsed({ percent, className }: { percent: number; className?: string }) {
  const { t } = useTranslation();
  const over = percent >= 100;
  return (
    <span className={cn('flex min-w-24 flex-col gap-1', className)}>
      <span className={cn('text-xs tabular-nums', over && 'font-bold text-destructive-text')}>
        {t('campaigns.budgetUsed', { percent: formatNumber(percent) })}
      </span>
      <Meter
        value={Math.min(percent, 100)}
        tone={over ? 'danger' : 'brand'}
        aria-label={t('campaigns.columns.budgetUsed')}
      />
    </span>
  );
}

/** A USD balance, red with "owed by the client" when negative (rule 15). */
export function Balance({ minor, className }: { minor: number; className?: string }) {
  const { t } = useTranslation();
  if (minor >= 0) return <Money minor={minor} currency="USD" className={className} />;
  return (
    <span className="inline-flex flex-col items-end">
      <Money minor={minor} currency="USD" className={cn('text-destructive-text', className)} />
      <span className="text-xs text-destructive-text">{t('campaigns.wallet.owed')}</span>
    </span>
  );
}

/** A cost per result, or "—" without results. */
export function CostPerResult({ minor }: { minor: number | null }): ReactNode {
  const { t } = useTranslation();
  if (minor === null) return <span className="text-muted-foreground">{t('common.none')}</span>;
  return <Money minor={minor} currency="USD" />;
}
