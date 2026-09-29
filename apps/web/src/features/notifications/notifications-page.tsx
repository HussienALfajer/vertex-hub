import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  NOTIFICATION_CATEGORIES,
  type Notification,
  type NotificationCategory,
} from '@vertex-hub/contracts';
import {
  Button,
  EmptyState,
  PageHeader,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { BellIcon, CheckCheckIcon, MailIcon, MailOpenIcon, SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { NotificationItem } from './notification-item';
import {
  notificationListQuery,
  unreadCountQuery,
  useMarkAllRead,
  useMarkRead,
  useMarkUnread,
} from './notifications.queries';

export interface NotificationsSearch {
  unread?: true;
  category?: NotificationCategory;
  page?: number;
}

const PAGE_SIZE = 20;
const ALL = 'all';

/** Reads the notification filters from the URL, dropping anything malformed. */
export function parseNotificationsSearch(search: Record<string, unknown>): NotificationsSearch {
  const page = Number(search.page);
  return {
    unread: search.unread === true || search.unread === 'true' ? true : undefined,
    category: NOTIFICATION_CATEGORIES.find((category) => category === search.category),
    page: Number.isInteger(page) && page > 1 ? page : undefined,
  };
}

/** Every notification of the signed-in user, filtered and paged (F14 screen 2). */
export function NotificationsPage({ search }: { search: NotificationsSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/notifications/' });
  const page = search.page ?? 1;
  const list = useQuery(
    notificationListQuery({
      unread: search.unread ? 'true' : undefined,
      category: search.category,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  const unread = useQuery(unreadCountQuery);
  const markAll = useMarkAllRead();

  const setFilter = (next: Partial<NotificationsSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next, page: undefined }), replace: true });

  const categoryItems = [
    { value: ALL, label: t('notifications.allCategories') },
    ...NOTIFICATION_CATEGORIES.map((category) => ({
      value: category,
      label: t(`notifications.categories.${category}`),
    })),
  ];

  return (
    <>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.subtitle')}
        actions={
          <>
            <Button variant="outline" render={<Link to="/notifications/settings" />}>
              <SettingsIcon />
              {t('notifications.settingsLink')}
            </Button>
            <Button
              disabled={!unread.data?.count || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              <CheckCheckIcon />
              {t('notifications.markAllRead')}
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center">
        <ToggleGroup
          aria-label={t('notifications.readFilter')}
          value={[search.unread ? 'unread' : ALL]}
          onValueChange={(value) => {
            if (value[0]) setFilter({ unread: value[0] === 'unread' ? true : undefined });
          }}
        >
          <ToggleGroupItem value={ALL}>{t('notifications.readFilters.all')}</ToggleGroupItem>
          <ToggleGroupItem value="unread">{t('notifications.readFilters.unread')}</ToggleGroupItem>
        </ToggleGroup>
        <Select
          items={categoryItems}
          value={search.category ?? ALL}
          onValueChange={(value) =>
            setFilter({
              category: value && value !== ALL ? (value as NotificationCategory) : undefined,
            })
          }
        >
          <SelectTrigger aria-label={t('notifications.category')} className="sm:ms-auto sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categoryItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <LoadError message={t('notifications.loadError')} onRetry={() => list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState
          icon={<BellIcon />}
          title={
            search.unread
              ? t('notifications.emptyUnread')
              : search.category
                ? t('notifications.emptyCategory')
                : t('notifications.emptyTitle')
          }
          description={
            search.unread || search.category
              ? t('notifications.emptyFilterHint')
              : t('notifications.emptyHint')
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {list.data.items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  actions={<ReadToggle notification={notification} />}
                />
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

function ReadToggle({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const label = notification.read ? t('notifications.markUnread') : t('notifications.markRead');
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={markRead.isPending || markUnread.isPending}
      onClick={() =>
        notification.read ? markUnread.mutate(notification.id) : markRead.mutate(notification.id)
      }
    >
      {notification.read ? <MailIcon /> : <MailOpenIcon />}
    </Button>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-4">
      {['a', 'b', 'c', 'd', 'e'].map((row) => (
        <div key={row} className="flex items-start gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
      ))}
    </div>
  );
}
