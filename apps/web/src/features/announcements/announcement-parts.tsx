import type {
  AnnouncementStatus,
  AnnouncementSummary,
  AnnouncementBody as Body,
  NotificationPriority,
} from '@vertex-hub/contracts';
import { Badge, type RichTextLabels, RichTextView } from '@vertex-hub/ui';
import {
  CalendarClockIcon,
  CircleCheckIcon,
  CircleDotIcon,
  OctagonAlertIcon,
  PinIcon,
  Undo2Icon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '../../lib/format';

/** Critical and important stand out; normal ones show no badge. */
export function PriorityBadge({ priority }: { priority: NotificationPriority }) {
  const { t } = useTranslation();
  if (priority === 'normal') return null;
  const tone =
    priority === 'critical' ? 'danger' : priority === 'important' ? 'warning' : 'neutral';
  return (
    <Badge tone={tone}>
      {priority === 'critical' && <OctagonAlertIcon aria-hidden="true" />}
      {t(`notifications.priorities.${priority}`)}
    </Badge>
  );
}

const STATUS_TONES = {
  draft: 'neutral',
  scheduled: 'info',
  sent: 'success',
  withdrawn: 'danger',
} as const satisfies Record<AnnouncementStatus, string>;

const STATUS_ICONS = {
  draft: CircleDotIcon,
  scheduled: CalendarClockIcon,
  sent: CircleCheckIcon,
  withdrawn: Undo2Icon,
} as const satisfies Record<AnnouncementStatus, unknown>;

export function StatusBadge({ status }: { status: AnnouncementStatus }) {
  const { t } = useTranslation();
  const Icon = STATUS_ICONS[status];
  return (
    <Badge tone={STATUS_TONES[status]}>
      <Icon aria-hidden="true" />
      {t(`announcements.statuses.${status}`)}
    </Badge>
  );
}

export function PinnedBadge({ until }: { until: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone="brand">
      <PinIcon aria-hidden="true" />
      {t('announcements.pinnedUntil', { date: formatCalendarDate(until) })}
    </Badge>
  );
}

/** When an announcement went out, else when it goes, else when it was written. */
export function announcementTime(announcement: AnnouncementSummary): string {
  return announcement.sentAt ?? announcement.scheduledAt ?? announcement.createdAt;
}

/** The caller's own state as a recipient: not opened, waiting for "I have read this", or done. */
export function ReceiptBadge({ announcement }: { announcement: AnnouncementSummary }) {
  const { t } = useTranslation();
  const receipt = announcement.receipt;
  if (!receipt || announcement.status !== 'sent') return null;
  if (announcement.requiresAck && !receipt.acknowledgedAt) {
    return <Badge tone="warning">{t('announcements.receipt.needsAck')}</Badge>;
  }
  if (announcement.requiresAck) {
    return <Badge tone="success">{t('announcements.receipt.acknowledged')}</Badge>;
  }
  return null;
}

/** Rule D13: the body rendered from its nodes, never from HTML. */
export function AnnouncementBodyView({ body, className }: { body: Body; className?: string }) {
  return <RichTextView doc={body} className={className} />;
}

/** The editor's toolbar labels. */
export function useRichTextLabels(): RichTextLabels {
  const { t } = useTranslation();
  return {
    toolbar: t('announcements.editor.toolbar'),
    bold: t('announcements.editor.bold'),
    emphasis: t('announcements.editor.emphasis'),
    heading: t('announcements.editor.heading'),
    bulletList: t('announcements.editor.bulletList'),
    orderedList: t('announcements.editor.orderedList'),
    link: t('announcements.editor.link'),
    removeLink: t('announcements.editor.removeLink'),
    linkUrl: t('announcements.editor.linkUrl'),
    linkApply: t('announcements.editor.linkApply'),
    linkInvalid: t('announcements.editor.linkInvalid'),
  };
}
