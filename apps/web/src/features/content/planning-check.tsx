import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  addDays,
  businessDate,
  type ClientPlanning,
  type Commitment,
  type ContentPillar,
  daysInclusive,
  type PillarBalanceItem,
  PLANNING_RULES,
  type PlanningIssue,
} from '@vertex-hub/contracts';
import { Badge, ChartDot, EmptyState, Meter, Skeleton } from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import {
  CalendarHeartIcon,
  CalendarX2Icon,
  ChartPieIcon,
  ClipboardCheckIcon,
  type LucideIcon,
  PackageCheckIcon,
  TimerIcon,
} from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatCalendarDate, formatMonth, formatNumber } from '../../lib/format';
import {
  contentOccasionsQuery,
  contentPillarsQuery,
  contentPlanningQuery,
} from './content.queries';

/*
 * The planning check (spec F08B rule C10, screen 2 "Planning check"): per client, the next 14
 * days' issues with links to their days, and the month's pillar balance and commitments. The
 * client's month bar shows the same balance and commitments for the month viewed.
 */

const ISSUE_ICONS: Record<PlanningIssue['kind'], LucideIcon> = {
  gap: CalendarX2Icon,
  too_close: TimerIcon,
  under_committed: PackageCheckIcon,
  occasion_uncovered: CalendarHeartIcon,
  pillar_mix: ChartPieIcon,
};

/** The Planning check tab of the Content page. */
export function PlanningCheck() {
  const { t } = useTranslation();
  const from = businessDate();
  const to = addDays(from, PLANNING_RULES.weekCheckDays - 1);
  const planning = useQuery(contentPlanningQuery({ from, to }));
  // An occasion is flagged from its lead days before it starts (up to 30): name those too.
  const occasions = useQuery(contentOccasionsQuery({ from, to: addDays(to, 30) }));
  const pillars = useQuery(contentPillarsQuery);
  if (planning.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (planning.isError) {
    return (
      <LoadError message={t('content.planning.loadError')} onRetry={() => planning.refetch()} />
    );
  }
  const occasionNames = new Map(
    (occasions.data?.items ?? []).map((occasion) => [occasion.id, occasion.name]),
  );
  // Clients with issues first, then the rest by name as the API gave them.
  const clients = [...planning.data.clients].sort(
    (a, b) => Number(b.issues.length > 0) - Number(a.issues.length > 0),
  );
  if (clients.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardCheckIcon />}
        title={t('content.planning.noClientsTitle')}
        description={t('content.planning.noClientsHint')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {t('content.planning.hint', {
          from: formatCalendarDate(from),
          to: formatCalendarDate(to),
        })}
      </p>
      {clients.map((entry) => (
        <ClientPlanningCard
          key={entry.client.id}
          entry={entry}
          occasionNames={occasionNames}
          pillars={pillars.data?.items ?? []}
        />
      ))}
    </div>
  );
}

function ClientPlanningCard({
  entry,
  occasionNames,
  pillars,
}: {
  entry: ClientPlanning;
  occasionNames: Map<string, string>;
  pillars: ContentPillar[];
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      data-planning-client={entry.client.id}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <h2 id={titleId} className="text-base font-bold">
          <Link
            to="/clients/$clientId"
            params={{ clientId: entry.client.id }}
            search={{ tab: 'content' }}
            className="hover:underline"
          >
            {entry.client.name}
          </Link>
        </h2>
        <Badge tone={entry.issues.length > 0 ? 'warning' : 'success'} className="tabular-nums">
          {entry.issues.length > 0
            ? t('content.planning.issueCount', {
                count: entry.issues.length,
                n: formatNumber(entry.issues.length),
              })
            : t('content.planning.noIssues')}
        </Badge>
      </div>
      <div className="grid gap-6 p-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-2">
          {entry.issues.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('content.planning.allGood')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {entry.issues.map((issue) => (
                <IssueRow
                  key={`${issue.kind}:${issue.date}:${issue.postIds.join()}:${issue.occasionId ?? ''}:${issue.commitment ?? ''}`}
                  issue={issue}
                  clientId={entry.client.id}
                  occasionNames={occasionNames}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col gap-5">
          <PillarBalance
            month={entry.pillarBalance.month}
            posts={entry.pillarBalance.posts}
            items={entry.pillarBalance.items}
            pillars={pillars}
          />
          <Commitments commitments={entry.commitments} />
        </div>
      </div>
    </section>
  );
}

/** One issue in a line, linking to its first day on the client's calendar. */
function IssueRow({
  issue,
  clientId,
  occasionNames,
}: {
  issue: PlanningIssue;
  clientId: string;
  occasionNames: Map<string, string>;
}) {
  const { t } = useTranslation();
  const Icon = ISSUE_ICONS[issue.kind];
  return (
    <li data-issue={issue.kind} className="flex items-start gap-2 text-sm">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-warning-foreground" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{issueText(t, issue, occasionNames)}</span>
        <Link
          to="/content"
          search={{ date: issue.date, clientId }}
          className="w-fit text-xs text-muted-foreground hover:underline"
        >
          {t('content.planning.openDay', { date: formatCalendarDate(issue.date) })}
        </Link>
      </span>
    </li>
  );
}

/** What an issue says, per kind (rules C2, C6–C9). */
export function issueText(
  t: TFunction,
  issue: PlanningIssue,
  occasionNames: Map<string, string>,
): string {
  switch (issue.kind) {
    case 'gap': {
      const end = issue.endDate ?? issue.date;
      return t('content.planning.issues.gap', {
        from: formatCalendarDate(issue.date),
        to: formatCalendarDate(end),
        n: formatNumber(daysInclusive(issue.date, end)),
      });
    }
    case 'too_close':
      return t('content.planning.issues.too_close', {
        date: formatCalendarDate(issue.date),
        platform: issue.platform ? t(`clients.platforms.names.${issue.platform}`) : '',
      });
    case 'under_committed':
      return t('content.planning.issues.under_committed', {
        kind: issue.commitment ? t(`content.planning.commitments.${issue.commitment}`) : '',
        planned: formatNumber(issue.planned ?? 0),
        committed: formatNumber(issue.committed ?? 0),
      });
    case 'occasion_uncovered':
      return t('content.planning.issues.occasion_uncovered', {
        name:
          (issue.occasionId && occasionNames.get(issue.occasionId)) ||
          t('content.planning.anOccasion'),
        date: formatCalendarDate(issue.date),
      });
    case 'pillar_mix':
      return t('content.planning.issues.pillar_mix', { month: formatMonth(issue.date) });
  }
}

/**
 * Rule C2: each pillar's share of the month's posts as a bar, with its target when the client set
 * one; off balance in the warning tone. "No pillar" counts apart.
 */
export function PillarBalance({
  month,
  posts,
  items,
  pillars,
  compact = false,
}: {
  month: string;
  posts: number;
  items: PillarBalanceItem[];
  pillars: ContentPillar[];
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const shown = items.filter((item) => item.count > 0 || item.target !== null);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-pillar-balance>
      <h3 id={titleId} className="text-sm font-medium">
        {t('content.planning.balanceTitle', {
          month: formatMonth(`${month}-01`),
          n: formatNumber(posts),
        })}
      </h3>
      {shown.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('content.planning.balanceEmpty')}</p>
      ) : (
        <ul
          aria-labelledby={titleId}
          className={compact ? 'grid gap-2 sm:grid-cols-2' : 'flex flex-col gap-2'}
        >
          {shown.map((item) => {
            const pillar = pillars.find((candidate) => candidate.id === item.pillarId);
            const name = pillar?.name ?? t('content.planning.noPillar');
            return (
              <li
                key={item.pillarId ?? 'none'}
                className="flex flex-col gap-1 text-xs"
                data-off={item.off || undefined}
              >
                <span className="flex items-center gap-1.5">
                  {pillar && <ChartDot color={pillar.color} muted={pillar.archived} />}
                  <span className="truncate">{name}</span>
                  <span className="ms-auto tabular-nums text-muted-foreground">
                    {item.target === null
                      ? t('content.planning.share', { share: formatNumber(item.share) })
                      : t('content.planning.shareOfTarget', {
                          share: formatNumber(item.share),
                          target: formatNumber(item.target),
                        })}
                  </span>
                  {item.off && <Badge tone="warning">{t('content.planning.off')}</Badge>}
                </span>
                <Meter
                  value={item.share}
                  max={100}
                  tone={item.off ? 'warning' : 'brand'}
                  aria-label={name}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Rule C9: per open cycle and kind, the posts planned against the lines committed. */
export function Commitments({ commitments }: { commitments: Commitment[] }) {
  const { t } = useTranslation();
  const titleId = useId();
  if (commitments.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-commitments>
      <h3 id={titleId} className="text-sm font-medium">
        {t('content.planning.commitmentsTitle')}
      </h3>
      <ul aria-labelledby={titleId} className="flex flex-col gap-1.5">
        {commitments.map((commitment) => {
          const short = commitment.planned < commitment.committed;
          return (
            <li
              key={`${commitment.cycleId}:${commitment.kind}`}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            >
              <span className="font-medium">
                {t(`content.planning.commitments.${commitment.kind}`)}
              </span>
              <span className="tabular-nums" dir="ltr">
                {t('content.planning.plannedOf', {
                  planned: formatNumber(commitment.planned),
                  committed: formatNumber(commitment.committed),
                })}
              </span>
              {short && <Badge tone="warning">{t('content.planning.short')}</Badge>}
              <span className="truncate text-muted-foreground">
                {t('content.planning.cycleOf', {
                  name: commitment.retainer.name,
                  from: formatCalendarDate(commitment.from),
                  to: formatCalendarDate(commitment.to),
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
