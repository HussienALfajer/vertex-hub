import { Link } from '@tanstack/react-router';
import { type Notification, SNOOZE_OPTIONS } from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
} from '@vertex-hub/ui';
import type { TFunction } from 'i18next';
import { AlarmClockIcon, BellRingIcon, OctagonAlertIcon, VideoIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatRelativeTime } from '../../lib/format';
import { imageSrc } from '../../lib/images';
import { useDepartmentNames } from '../projects/project-badges';
import { notificationLink, notificationText } from './notification-content';
import { useMarkRead, useSnooze, useUnsnooze } from './notifications.queries';

/**
 * One notification: who (or the system), the rendered text, its client and project, when, and an
 * unread dot. Opening it opens its subject and marks it read (F14 rule 15). F16: critical rows
 * carry the red mark (screen 3), closed rows say who handled them (rule B5), open rows can be
 * snoozed (rule B8), and a meeting about to start offers its link (part C, `meeting_starting`).
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
  const state = resolutionText(t, notification);

  function open() {
    if (!notification.read) markRead.mutate(notification.id);
    onOpen?.();
  }

  return (
    <div
      data-unread={!notification.read || undefined}
      data-priority={notification.priority}
      className="relative flex items-start gap-3 px-4 py-3 transition-colors duration-150 ease-out hover:bg-muted/60"
    >
      {notification.actor ? (
        <Avatar
          name={notification.actor.name}
          src={imageSrc(notification.actor.imageId, 'sm')}
          size="sm"
          className="size-8"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <BellRingIcon className="size-4" aria-hidden="true" />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {notification.priority === 'critical' && (
          <Badge tone="danger" className="mb-0.5">
            <OctagonAlertIcon aria-hidden="true" />
            {t('notifications.priorities.critical')}
          </Badge>
        )}
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
        {state && <span className="text-xs font-medium text-muted-foreground">{state}</span>}
        {notification.type === 'meeting_starting' && notification.data.joinUrl && (
          // Above the row's link, which covers the row.
          <span className="relative mt-1 self-start">
            <Button
              variant="outline"
              size="sm"
              render={<a href={notification.data.joinUrl} target="_blank" rel="noreferrer" />}
            >
              <VideoIcon />
              {t('notifications.join')}
            </Button>
          </span>
        )}
        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <time dateTime={notification.updatedAt} title={formatDateTime(notification.updatedAt)}>
            {formatRelativeTime(notification.updatedAt)}
          </time>
          {notification.snoozedUntil && (
            <span className="flex items-center gap-1">
              <AlarmClockIcon className="size-3" aria-hidden="true" />
              {t('notifications.snooze.until', { time: formatDateTime(notification.snoozedUntil) })}
            </span>
          )}
        </span>
      </div>
      <div className="relative flex shrink-0 items-center gap-1">
        {actions}
        <SnoozeAction notification={notification} />
        {!notification.read && (
          <span className="mt-1.5 size-2 rounded-full bg-primary">
            <span className="sr-only">{t('notifications.unread')}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** Rule B5: "Handled by …" for rows someone else closed, "No longer needed" for void ones. */
function resolutionText(t: TFunction, notification: Notification): string | null {
  const { resolution } = notification;
  if (!resolution) return null;
  if (resolution.outcome === 'void') return t('notifications.resolution.void');
  if (notification.inbox === 'done') return t('notifications.resolution.byYou');
  return resolution.by
    ? t('notifications.resolution.handledBy', { name: resolution.by.name })
    : t('notifications.resolution.handled');
}

/**
 * Rule B8: any unread or "Needs you" row can wait 1 hour, 3 hours, or until the next work day at
 * 09:00; a snoozed row can come back now.
 */
function SnoozeAction({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const snooze = useSnooze();
  const unsnooze = useUnsnooze();
  if (notification.inbox === 'snoozed') {
    return (
      <IconButton
        label={t('notifications.snooze.wake')}
        disabled={unsnooze.isPending}
        onClick={() => unsnooze.mutate(notification.id)}
      >
        <BellRingIcon />
      </IconButton>
    );
  }
  const snoozable =
    !notification.resolution && (notification.inbox === 'needs_you' || !notification.read);
  if (!snoozable) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton label={t('notifications.snooze.later')} disabled={snooze.isPending} />}
      >
        <AlarmClockIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SNOOZE_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => snooze.mutate({ id: notification.id, option })}
          >
            {t(`notifications.snooze.options.${option}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
