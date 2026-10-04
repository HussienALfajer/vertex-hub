import type { Lead, LeadSource, LeadStage } from '@vertex-hub/contracts';
import { Badge, cn, PlatformMark } from '@vertex-hub/ui';
import {
  CalendarClockIcon,
  CircleDotIcon,
  HandshakeIcon,
  type LucideIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  StoreIcon,
  TargetIcon,
  TicketIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '../../lib/format';
import { formatMoney } from '../../lib/money';

/** Open stages in the workflow colors; Won takes Vertex Green, Lost the danger tone. */
const stageTone = {
  new: 'neutral',
  contacted: 'info',
  meeting: 'gold',
  quote_sent: 'warning',
  won: 'brand',
  lost: 'danger',
} as const satisfies Record<LeadStage, string>;

export function LeadStageBadge({ stage }: { stage: LeadStage }) {
  const { t } = useTranslation();
  return (
    <Badge tone={stageTone[stage]} data-stage={stage}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {t(`leads.stages.${stage}`)}
    </Badge>
  );
}

/** Marks a quote's recipient as a lead not converted yet (F03 rule 16). */
export function LeadBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="outline">
      <TargetIcon aria-hidden="true" />
      {t('leads.badge')}
    </Badge>
  );
}

/** Sources with a platform glyph; the others take an icon. */
const platformOf = {
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  website: 'website',
} as const;

const sourceIcon: Record<Exclude<LeadSource, keyof typeof platformOf>, LucideIcon> = {
  whatsapp: MessageCircleIcon,
  referral: HandshakeIcon,
  paid_ad: MegaphoneIcon,
  event: TicketIcon,
  walk_in: StoreIcon,
  other: CircleDotIcon,
};

/** The source as a small tile, named for assistive technology unless `decorative`. */
export function SourceMark({
  source,
  decorative,
  className,
}: {
  source: LeadSource;
  decorative?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = decorative ? undefined : t(`leads.sources.${source}`);
  if (source in platformOf) {
    return (
      <PlatformMark
        platform={platformOf[source as keyof typeof platformOf]}
        size="xs"
        label={label}
        className={className}
      />
    );
  }
  const Icon = sourceIcon[source as keyof typeof sourceIcon];
  const tile = cn(
    'inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-foreground',
    className,
  );
  const icon = <Icon aria-hidden="true" className="size-3" strokeWidth={1.75} />;
  return label ? (
    <span role="img" aria-label={label} className={tile}>
      {icon}
    </span>
  ) : (
    <span aria-hidden="true" className={tile}>
      {icon}
    </span>
  );
}

/** The next follow-up date: red when overdue, amber today (screen 1). */
export function FollowUpDate({
  lead,
  className,
}: {
  lead: Pick<Lead, 'nextFollowUpOn' | 'followUpOverdue' | 'followUpDueToday'>;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!lead.nextFollowUpOn) return null;
  const tone = lead.followUpOverdue ? 'danger' : lead.followUpDueToday ? 'warning' : null;
  const text = lead.followUpDueToday
    ? t('leads.followUp.today')
    : formatCalendarDate(lead.nextFollowUpOn);
  if (!tone) {
    return (
      <span className={cn('flex items-center gap-1 tabular-nums', className)}>
        <CalendarClockIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="sr-only">{t('leads.followUp.label')}</span>
        {text}
      </span>
    );
  }
  return (
    <Badge tone={tone} className={className}>
      <CalendarClockIcon aria-hidden="true" />
      <span className="sr-only">{t('leads.followUp.label')}</span>
      {lead.followUpOverdue ? t('leads.followUp.overdue', { date: text }) : text}
    </Badge>
  );
}

export function Budget({
  lead,
  className,
}: {
  lead: Pick<Lead, 'budgetMinor' | 'budgetCurrency'>;
  className?: string;
}) {
  if (lead.budgetMinor === null || lead.budgetCurrency === null) return null;
  return (
    <span dir="ltr" className={cn('tabular-nums', className)}>
      {formatMoney(lead.budgetMinor, lead.budgetCurrency)}
    </span>
  );
}
