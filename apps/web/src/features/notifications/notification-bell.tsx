import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
  Skeleton,
} from '@vertex-hub/ui';
import { BellIcon, CheckCheckIcon, CloudOffIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../lib/format';
import { NotificationItem } from './notification-item';
import { useNotificationStream } from './notification-stream';
import {
  BELL_FILTERS,
  notificationListQuery,
  unreadCountQuery,
  useMarkAllRead,
} from './notifications.queries';

/** The count shown on the bell: `99+` above 99 (F14 rule 15). */
export function unreadBadge(count: number): string {
  return count > 99 ? `${formatNumber(99)}+` : formatNumber(count);
}

/** The bell in the app shell header, with the 10 newest notifications (F14 screen 1). */
export function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  useNotificationStream(() => setOpen(true));
  const unread = useQuery(unreadCountQuery);
  // The badge hides when the count cannot load.
  const count = unread.isError ? 0 : (unread.data?.count ?? 0);
  const label = count > 0 ? t('notifications.bellUnread', { count }) : t('notifications.bell');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="relative" aria-label={label} />}
      >
        <BellIcon />
        {count > 0 && (
          <span
            aria-hidden="true"
            data-slot="unread-count"
            className="absolute -top-0.5 -end-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-xs leading-none font-medium text-primary-foreground"
          >
            {unreadBadge(count)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <BellPanel onClose={() => setOpen(false)} unread={count} />
      </PopoverContent>
    </Popover>
  );
}

function BellPanel({ onClose, unread }: { onClose: () => void; unread: number }) {
  const { t } = useTranslation();
  const list = useQuery(notificationListQuery(BELL_FILTERS));
  const markAll = useMarkAllRead();

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <PopoverTitle>{t('notifications.title')}</PopoverTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0 || markAll.isPending}
            focusableWhenDisabled
            onClick={() => markAll.mutate()}
          >
            <CheckCheckIcon />
            {t('notifications.markAllRead')}
          </Button>
          <IconButton
            label={t('notifications.settingsLink')}
            render={<Link to="/notifications/settings" />}
            onClick={onClose}
          >
            <SettingsIcon />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <div className="flex flex-col gap-4 p-4">
            {['a', 'b', 'c'].map((row) => (
              <div key={row} className="flex items-start gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : list.isError ? (
          <div role="alert" className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <CloudOffIcon className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm">{t('notifications.loadError')}</p>
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : list.data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <BellIcon className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">{t('notifications.emptyTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('notifications.emptyHint')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {list.data.items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem notification={notification} onOpen={onClose} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          className="w-full"
          render={<Link to="/notifications" />}
          onClick={onClose}
        >
          {t('notifications.viewAll')}
        </Button>
      </div>
    </>
  );
}
