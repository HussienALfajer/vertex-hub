import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { MyContentSummary, PostView } from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  cn,
  EmptyState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import {
  CalendarClockIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  type LucideIcon,
  PlusIcon,
  SunIcon,
  UndoIcon,
  UserRoundSearchIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { myContentSummaryQuery, postListQuery } from './content.queries';
import { type CalendarState, ContentCalendar, parseCalendarState } from './content-calendar';
import { NewPostDialog } from './post-form';
import { PostRows } from './post-parts';

export interface ContentSearch extends CalendarState {
  /** Unset means the calendar. */
  tab?: 'mine';
}

export function parseContentSearch(search: Record<string, unknown>): ContentSearch {
  return { tab: search.tab === 'mine' ? 'mine' : undefined, ...parseCalendarState(search) };
}

/**
 * The Content page (spec F08, screen 1): the calendar of every client and My posts, the tab and
 * the calendar's state kept in the URL.
 */
export function ContentPage({ search }: { search: ContentSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/content/' });
  const [creating, setCreating] = useState(false);
  const { tab, ...state } = search;
  const setState = useCallback(
    (next: Partial<CalendarState>) =>
      navigate({ search: (previous) => ({ ...previous, ...next }), replace: true }),
    [navigate],
  );
  const newPost = can(me, 'content.manage') && (
    <Button onClick={() => setCreating(true)}>
      <PlusIcon />
      {t('content.actions.new')}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t('content.title')}
        description={t('content.subtitle')}
        actions={newPost}
      />
      <Tabs
        value={tab ?? 'calendar'}
        onValueChange={(value: 'calendar' | 'mine') =>
          navigate({
            search: (previous) => ({ ...previous, tab: value === 'mine' ? 'mine' : undefined }),
            replace: true,
          })
        }
      >
        <TabsList aria-label={t('content.title')}>
          <TabsTrigger value="calendar">
            <CalendarDaysIcon />
            {t('content.tabs.calendar')}
          </TabsTrigger>
          <TabsTrigger value="mine">
            <UserRoundSearchIcon />
            {t('content.tabs.mine')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="calendar">
          <ContentCalendar state={state} onChange={setState} emptyAction={newPost} />
        </TabsContent>
        <TabsContent value="mine">
          <MyPosts />
        </TabsContent>
      </Tabs>
      {creating && <NewPostDialog defaultDate={state.date} onClose={() => setCreating(false)} />}
    </>
  );
}

interface Section {
  key: keyof MyContentSummary;
  view: PostView;
  icon: LucideIcon;
  /** Needs attention first: shown in the danger tone. */
  alert?: boolean;
}

const SECTIONS: Section[] = [
  { key: 'overdue', view: 'overdue', icon: CalendarClockIcon, alert: true },
  { key: 'publishToday', view: 'publish_today', icon: SunIcon },
  { key: 'returned', view: 'returned', icon: UndoIcon },
  { key: 'toReview', view: 'to_review', icon: ClipboardCheckIcon },
];

/** Posts of a section on this page. */
const SECTION_SIZE = 20;

/**
 * My posts: what the user publishes today, what is overdue or was returned to them, and for
 * reviewers what waits for their review. Counts come from the summary; a section loads its posts
 * only when it has some.
 */
function MyPosts() {
  const { t } = useTranslation();
  const summary = useQuery(myContentSummaryQuery);
  if (summary.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (summary.isError) {
    return <LoadError message={t('content.my.loadError')} onRetry={() => summary.refetch()} />;
  }
  const shown = SECTIONS.filter((section) => (summary.data[section.key] ?? 0) > 0);
  if (shown.length === 0) {
    return (
      <EmptyState
        icon={<UserRoundSearchIcon />}
        title={t('content.my.emptyTitle')}
        description={t('content.my.emptyHint')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {shown.map((section) => (
        <PostSection key={section.key} section={section} count={summary.data[section.key] ?? 0} />
      ))}
    </div>
  );
}

function PostSection({ section, count }: { section: Section; count: number }) {
  const { t } = useTranslation();
  const posts = useQuery(postListQuery({ view: section.view, pageSize: SECTION_SIZE }));
  const { icon: Icon } = section;
  const titleId = `posts-${section.key}`;
  return (
    <section
      aria-labelledby={titleId}
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-5',
            section.alert ? 'text-destructive-text' : 'text-muted-foreground',
            section.icon === UndoIcon && 'rtl:-scale-x-100',
          )}
        />
        <h2 id={titleId} className="text-base font-bold">
          {t(`content.my.sections.${section.key}`)}
        </h2>
        <Badge tone={section.alert ? 'danger' : 'neutral'} className="tabular-nums">
          {formatNumber(count)}
        </Badge>
        {count > SECTION_SIZE && (
          <span className="ms-auto text-xs text-muted-foreground">
            {t('content.my.firstOnly', { n: formatNumber(SECTION_SIZE) })}
          </span>
        )}
      </div>
      {posts.isPending ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : posts.isError ? (
        <div className="p-4">
          <LoadError message={t('content.my.loadError')} onRetry={() => posts.refetch()} />
        </div>
      ) : (
        <PostRows posts={posts.data.items} />
      )}
    </section>
  );
}
