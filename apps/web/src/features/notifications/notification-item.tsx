import { Link } from '@tanstack/react-router';
import type { Notification } from '@vertex-hub/contracts';
import { Avatar, cn } from '@vertex-hub/ui';
import { BellRingIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { useDepartmentNames } from '../projects/project-badges';
import { notificationLink, notificationText } from './notification-content';
import { useMarkRead } from './notifications.queries';

/**
 * One notification: who (or the system), the rendered text, its client and project, when, and an
 * unread dot. Opening it opens its subject and marks it read (F14 rule 15).
 */
export function NotificationItem({
  notification,
  onOpen,
  actions,
}: {
  notification: Notification;
  /** Called after the link is followed (the bell closes). */
  onOpen?: () => void;
  /** Row actions (the page's mark read/unread). */
  actions?: ReactNode;
}) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const markRead = useMarkRead();
  const { text, context } = notificationText(notification, departmentName);

  function open() {
    if (!notification.read) markRead.mutate(notification.id);
    onOpen?.();
  }

  return (
    <div
      data-unread={!notification.read || undefined}
      className="relative flex items-start gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/60"
    >
      {notification.actor ? (
        <Avatar name={notification.actor.name} size="sm" className="size-8" />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <BellRingIcon className="size-4" aria-hidden="true" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          {...notificationLink(notification)}
          onClick={open}
          className={cn(
            'rounded-sm text-sm outline-offset-2 after:absolute after:inset-0',
            notification.read ? 'text-muted-foreground' : 'font-medium text-foreground',
          )}
        >
          {text}
        </Link>
        {context && <span className="truncate text-xs text-muted-foreground">{context}</span>}
        <time
          dateTime={notification.updatedAt}
          title={formatDateTime(notification.updatedAt)}
          className="text-xs text-muted-foreground"
        >
          {formatRelativeTime(notification.updatedAt)}
        </time>
      </div>
      <div className="relative flex shrink-0 items-center gap-1">
        {actions}
        {!notification.read && (
          <span className="mt-1.5 size-2 rounded-full bg-primary">
            <span className="sr-only">{t('notifications.unread')}</span>
          </span>
        )}
      </div>
    </div>
  );
}
