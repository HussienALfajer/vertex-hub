import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_VIEWS,
  type AnnouncementStatus,
  type AnnouncementSummary,
  type MeResponse,
} from '@vertex-hub/contracts';
import {
  Button,
  cn,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { MegaphoneIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { scopesOf, useMe } from '../../lib/auth';
import { formatNumber, formatRelativeTime } from '../../lib/format';
import { listParam, oneOfParam, pageParam, textParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useSearchText } from '../../lib/use-search-text';
import {
  announcementTime,
  PinnedBadge,
  PriorityBadge,
  ReceiptBadge,
  StatusBadge,
} from './announcement-parts';
import { announcementListQuery } from './announcements.queries';

type View = (typeof ANNOUNCEMENT_VIEWS)[number];

export interface AnnouncementsSearch {
  /** "Received" when left out. */
  view?: Exclude<View, 'received'>;
  status?: AnnouncementStatus[];
  search?: string;
  page?: number;
}

const PAGE_SIZE = 20;

/** Rule D10: holders of `announcements.manage` `all` read every announcement. */
export const readsAllAnnouncements = (me: MeResponse) =>
  scopesOf(me, 'announcements.manage').includes('all');

export function parseAnnouncementsSearch(search: Record<string, unknown>): AnnouncementsSearch {
  return {
    view: oneOfParam(['sent', 'all'] as const, search.view),
    status: listParam(ANNOUNCEMENT_STATUSES, search.status),
    search: textParam(search.search, 100),
    page: pageParam(search.page),
  };
}

/** Screen 11: received, sent and (for managers) every announcement, searched and filtered. */
export function AnnouncementsPage({ search }: { search: AnnouncementsSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/announcements/' });
  const view: View = search.view ?? 'received';
  const page = search.page ?? 1;
  // Recipients see sent announcements only; the author's own drafts are under "Sent by me".
  const statuses = view === 'received' ? undefined : search.status;
  const list = useQuery(
    announcementListQuery({
      view,
      status: statuses,
      search: search.search,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    list.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );
  const setFilter = useCallback(
    (next: Partial<AnnouncementsSearch>) =>
      navigate({
        search: (previous) => ({ ...previous, ...next, page: undefined }),
        replace: true,
      }),
    [navigate],
  );
  const [text, setText] = useSearchText(search.search, setFilter);
  const views = ANNOUNCEMENT_VIEWS.filter((value) => value !== 'all' || readsAllAnnouncements(me));
  const statusChoices = ANNOUNCEMENT_STATUSES.filter(
    (status) => status !== 'draft' || view === 'sent',
  );

  return (
    <>
      <PageHeader
        title={t('announcements.title')}
        description={t('announcements.subtitle')}
        actions={
          <Button render={<Link to="/announcements/new" />}>
            <PlusIcon />
            {t('announcements.new')}
          </Button>
        }
      />

      <Tabs
        value={view}
        onValueChange={(next: View) =>
          setFilter({ view: next === 'received' ? undefined : next, status: undefined })
        }
      >
        <TabsList aria-label={t('announcements.view')}>
          {views.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`announcements.views.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t('announcements.search')}
            aria-label={t('announcements.search')}
            className="ps-9"
          />
        </div>
        {view !== 'received' && (
          <ToggleGroup
            multiple
            aria-label={t('announcements.statusFilter')}
            value={search.status ?? []}
            onValueChange={(next: AnnouncementStatus[]) =>
              setFilter({ status: next.length ? next : undefined })
            }
            className="flex-wrap"
          >
            {statusChoices.map((status) => (
              <ToggleGroupItem key={status} value={status}>
                {t(`announcements.statuses.${status}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <LoadError message={t('announcements.loadError')} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<MegaphoneIcon />}
          title={
            search.search || search.status
              ? t('announcements.emptyFiltered')
              : t(`announcements.empty.${view}`)
          }
          description={
            search.search || search.status
              ? t('announcements.emptyFilteredHint')
              : t('announcements.emptyHint')
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {list.data.items.map((announcement) => (
              <li key={announcement.id}>
                <AnnouncementRow announcement={announcement} showStatus={view !== 'received'} />
              </li>
            ))}
          </ul>
          <Pagination
            page={page}
            pageCount={Math.ceil(list.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + list.data.items.length),
              total: formatNumber(list.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

function AnnouncementRow({
  announcement,
  showStatus,
}: {
  announcement: AnnouncementSummary;
  showStatus: boolean;
}) {
  const { t } = useTranslation();
  const unread =
    announcement.status === 'sent' && !!announcement.receipt && !announcement.receipt.openedAt;
  const editable = announcement.status === 'draft' || announcement.status === 'scheduled';
  const pinned =
    announcement.status === 'sent' && announcement.pinnedUntil ? announcement.pinnedUntil : null;
  return (
    <div className="relative flex items-start gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/60">
      <span
        aria-hidden="true"
        className={cn(
          'mt-2 size-2 shrink-0 rounded-full',
          unread ? 'bg-primary' : 'bg-transparent',
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            {...(editable
              ? {
                  to: '/announcements/$announcementId/edit',
                  params: { announcementId: announcement.id },
                }
              : {
                  to: '/announcements/$announcementId',
                  params: { announcementId: announcement.id },
                })}
            className={cn(
              'rounded-sm outline-offset-2 after:absolute after:inset-0',
              unread ? 'font-semibold text-foreground' : 'font-medium text-foreground',
            )}
          >
            {announcement.title}
            {unread && <span className="sr-only"> ({t('announcements.unread')})</span>}
          </Link>
          <PriorityBadge priority={announcement.priority} />
          {showStatus && <StatusBadge status={announcement.status} />}
          {pinned && <PinnedBadge until={pinned} />}
          <ReceiptBadge announcement={announcement} />
        </div>
        {announcement.excerpt && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{announcement.excerpt}</p>
        )}
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span>{announcement.author.name}</span>
          <span>
            {announcement.status === 'scheduled' && announcement.scheduledAt
              ? t('announcements.scheduledFor', {
                  time: formatRelativeTime(announcement.scheduledAt),
                })
              : formatRelativeTime(announcementTime(announcement))}
          </span>
          {announcement.totals && (
            <span>
              {announcement.requiresAck
                ? t('announcements.totals.acknowledged', {
                    n: formatNumber(announcement.totals.acknowledged),
                    total: formatNumber(announcement.totals.recipients),
                  })
                : t('announcements.totals.opened', {
                    n: formatNumber(announcement.totals.opened),
                    total: formatNumber(announcement.totals.recipients),
                  })}
            </span>
          )}
          {announcement.unsentAt && announcement.status === 'draft' && (
            <span className="text-destructive-text">{t('announcements.unsent')}</span>
          )}
        </p>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd'].map((row) => (
        <div key={row} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
