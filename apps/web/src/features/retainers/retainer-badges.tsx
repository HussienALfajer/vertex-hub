import type {
  DeliverableKind,
  RenewalState,
  RetainerStatus,
  RetainerTermSummary,
} from '@vertex-hub/contracts';
import { Badge, cn, Meter } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  CalendarClockIcon,
  CalendarRangeIcon,
  CameraIcon,
  ClapperboardIcon,
  FileChartColumnIcon,
  LayoutGridIcon,
  type LucideIcon,
  MegaphoneIcon,
  PaletteIcon,
  ShapesIcon,
  SmartphoneIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  VideoIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMonth, formatNumber } from '../../lib/format';

const statusTone = { active: 'info', paused: 'warning', ended: 'neutral' } as const;

export function RetainerStatusBadge({ status }: { status: RetainerStatus }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone[status]} data-status={status}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`retainers.statuses.${status}`)}
    </Badge>
  );
}

/** R11: a line, or a cycle with a line, behind the pace of the month. */
export function BehindBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <TrendingDownIcon aria-hidden="true" />
      {t('retainers.behind')}
    </Badge>
  );
}

/** More delivered than committed on a line (R7). */
export function OverDeliveredBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="success">
      <TrendingUpIcon aria-hidden="true" />
      {t('retainers.overDelivered')}
    </Badge>
  );
}

/** R6: renewal due from 30 days before the date, overdue after it. */
/** F05B screen 2: "Term 2 · Nov 2026 – Jan 2027 · renews automatically". */
export function TermChip({ term }: { term: RetainerTermSummary }) {
  const { t } = useTranslation();
  return (
    <Badge tone="outline" className="h-auto min-h-6 whitespace-normal py-0.5">
      <CalendarRangeIcon aria-hidden="true" />
      {t('retainers.terms.chip', {
        number: formatNumber(term.number),
        start: formatMonth(term.startMonth),
        end: formatMonth(term.endMonth),
      })}
      {' · '}
      {term.status === 'scheduled'
        ? t('retainers.terms.statuses.scheduled')
        : t(`retainers.terms.endActions.${term.endAction}`)}
    </Badge>
  );
}

export function RenewalBadge({ state }: { state: RenewalState }) {
  const { t } = useTranslation();
  return (
    <Badge tone={state === 'overdue' ? 'danger' : 'warning'}>
      <CalendarClockIcon aria-hidden="true" />
      {t(`retainers.renewal.${state}`)}
    </Badge>
  );
}

export const DELIVERABLE_ICONS: Record<DeliverableKind, LucideIcon> = {
  design: PaletteIcon,
  reel: ClapperboardIcon,
  story: SmartphoneIcon,
  post: LayoutGridIcon,
  video: VideoIcon,
  photo_shoot: CameraIcon,
  ad_campaign: MegaphoneIcon,
  monthly_report: FileChartColumnIcon,
  other: ShapesIcon,
};

/** A deliverable line's name: its label when it has one, otherwise its kind. */
export function lineName(t: TFunction, line: { kind: DeliverableKind; label?: string | null }) {
  return line.label || t(`retainers.kinds.${line.kind}`);
}

export function DeliverableIcon({
  kind,
  className,
}: {
  kind: DeliverableKind;
  className?: string;
}) {
  const Icon = DELIVERABLE_ICONS[kind];
  return <Icon aria-hidden="true" className={cn('size-4 shrink-0', className)} />;
}

/**
 * A cycle's lines as compact counters ("designs 9/12 · reels 2/4"), a shortfall in the danger
 * color. The whole list is read as one sentence.
 */
export function CycleCounters({
  lines,
}: {
  lines: {
    id: string;
    kind: DeliverableKind;
    label: string | null;
    delivered: number;
    committed: number;
    behind: boolean;
  }[];
}) {
  const { t } = useTranslation();
  if (lines.length === 0) {
    return <span className="text-muted-foreground">{t('retainers.noLines')}</span>;
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {lines.map((line) => (
        <li
          key={line.id}
          data-behind={line.behind || undefined}
          className="flex items-center gap-1.5 data-behind:text-destructive-text"
        >
          <DeliverableIcon kind={line.kind} className="text-muted-foreground" />
          <span>{lineName(t, line)}</span>
          <span className="font-medium tabular-nums">
            {formatNumber(line.delivered)}/{formatNumber(line.committed)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** R13 as a bar and a percentage; a dash when nothing is committed or there is no cycle. */
export function DeliveryRate({ rate }: { rate: number | null }) {
  const { t } = useTranslation();
  if (rate === null) return <span className="text-muted-foreground">{t('common.none')}</span>;
  return (
    <span className="flex items-center gap-2">
      <Meter
        value={rate}
        tone={rate >= 100 ? 'success' : 'brand'}
        aria-label={t('retainers.columns.deliveryRate')}
        className="w-20"
      />
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatNumber(rate / 100, { style: 'percent' })}
      </span>
    </span>
  );
}
