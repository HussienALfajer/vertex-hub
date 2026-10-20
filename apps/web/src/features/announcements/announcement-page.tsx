import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { Announcement } from '@vertex-hub/contracts';
import { Badge, Button, Callout, PageHeader, Skeleton, toast } from '@vertex-hub/ui';
import {
  ArrowRightIcon,
  CalendarClockIcon,
  CheckIcon,
  ExternalLinkIcon,
  PencilIcon,
  Undo2Icon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatLinkHost } from '../../lib/format';
import { refreshNotifications } from '../notifications/notifications.queries';
import { AnnouncementAttachments } from './announcement-attachments';
import {
  AnnouncementBodyView,
  announcementTime,
  PinnedBadge,
  PriorityBadge,
  StatusBadge,
} from './announcement-parts';
import { AnnouncementPollCard } from './announcement-poll';
import { AnnouncementReceipts } from './announcement-receipts';
import {
  announcementQuery,
  useAcknowledgeAnnouncement,
  useWithdrawAnnouncement,
} from './announcements.queries';

/**
 * Screen 12: an announcement with its body, link, attachments, "I have read this" and poll; for
 * the author and managers, the receipts, Edit and Withdraw.
 */
export function AnnouncementPage({ announcementId }: { announcementId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const announcement = useQuery(announcementQuery(announcementId));
  const loaded = announcement.isSuccess;
  // Rule D4: reading opens it, which may resolve its notification in the bell.
  useEffect(() => {
    if (loaded) void refreshNotifications(queryClient);
  }, [loaded, queryClient]);

  return (
    <>
      <PageHeader
        title={announcement.data?.title ?? t('announcements.page.title')}
        actions={
          <>
            <Button variant="ghost" render={<Link to="/announcements" />}>
              <ArrowRightIcon className="ltr:-scale-x-100" />
              {t('announcements.back')}
            </Button>
            {announcement.data && <Actions announcement={announcement.data} />}
          </>
        }
      />
      {announcement.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40" />
        </div>
      ) : announcement.isError ? (
        <LoadError
          message={t('announcements.page.loadError')}
          error={announcement.error}
          onRetry={() => announcement.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <AnnouncementContent announcement={announcement.data} />
          {announcement.data.poll && (
            <AnnouncementPollCard
              announcementId={announcement.data.id}
              poll={announcement.data.poll}
            />
          )}
          {announcement.data.rights.receipts && (
            <AnnouncementReceipts announcement={announcement.data} />
          )}
        </div>
      )}
    </>
  );
}

function Actions({ announcement }: { announcement: Announcement }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const withdraw = useWithdrawAnnouncement(announcement.id);
  const [withdrawing, setWithdrawing] = useState(false);
  return (
    <>
      {announcement.rights.edit && (
        <Button
          variant="outline"
          render={
            <Link
              to="/announcements/$announcementId/edit"
              params={{ announcementId: announcement.id }}
            />
          }
        >
          <PencilIcon />
          {t('common.edit')}
        </Button>
      )}
      {announcement.rights.withdraw && (
        <Button variant="outline" onClick={() => setWithdrawing(true)}>
          <Undo2Icon />
          {t('announcements.withdraw')}
        </Button>
      )}
      <ConfirmDialog
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        title={t('announcements.withdrawTitle')}
        body={t('announcements.withdrawBody')}
        action={t('announcements.withdraw')}
        destructive
        pending={withdraw.isPending}
        onConfirm={async () => {
          await withdraw.mutateAsync();
          toast.add({ title: t('announcements.withdrawn'), type: 'success' });
          await navigate({ to: '/announcements', search: { view: 'sent' } });
        }}
      />
    </>
  );
}

/**
 * The announcement as its recipients read it: meta, body, link, attachments and "I have read
 * this". The critical dialog shows the same (rule D6).
 */
export function AnnouncementContent({
  announcement,
  onAcknowledged,
}: {
  announcement: Announcement;
  onAcknowledged?: () => void;
}) {
  const { t } = useTranslation();
  const acknowledge = useAcknowledgeAnnouncement(announcement.id);
  const [failure, setFailure] = useState<string | null>(null);
  const receipt = announcement.receipt;
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{announcement.author.name}</span>
        <time dateTime={announcementTime(announcement)}>
          {formatDateTime(announcementTime(announcement))}
        </time>
        <PriorityBadge priority={announcement.priority} />
        {announcement.status !== 'sent' && <StatusBadge status={announcement.status} />}
        {announcement.status === 'sent' && announcement.pinnedUntil && (
          <PinnedBadge until={announcement.pinnedUntil} />
        )}
        {announcement.editedAt && (
          <Badge tone="outline">
            {t('announcements.edited', { time: formatDateTime(announcement.editedAt) })}
          </Badge>
        )}
      </div>
      {announcement.status === 'withdrawn' && (
        <Callout
          tone="danger"
          icon={<Undo2Icon className="size-5" />}
          title={t('announcements.withdrawnTitle')}
          description={t('announcements.withdrawnBody', {
            name: announcement.withdrawnBy?.name ?? '',
            time: announcement.withdrawnAt ? formatDateTime(announcement.withdrawnAt) : '',
          })}
        />
      )}
      {announcement.status === 'scheduled' && announcement.scheduledAt && (
        <Callout
          tone="info"
          icon={<CalendarClockIcon className="size-5" />}
          title={t('announcements.scheduledTitle', {
            time: formatDateTime(announcement.scheduledAt),
          })}
        />
      )}
      <div className="rounded-lg border border-border bg-surface p-5">
        <AnnouncementBodyView body={announcement.body} />
      </div>
      {announcement.linkUrl && (
        <Button
          variant="outline"
          className="self-start"
          render={<a href={announcement.linkUrl} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon />
          {announcement.linkLabel ?? formatLinkHost(announcement.linkUrl)}
          <span className="sr-only">{t('common.openInNewTab')}</span>
        </Button>
      )}
      <AnnouncementAttachments announcementId={announcement.id} />
      {announcement.requiresAck && receipt && announcement.status === 'sent' && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-4">
          {receipt.acknowledgedAt ? (
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckIcon className="size-4 text-status-success-foreground" aria-hidden="true" />
              {t('announcements.acknowledgedAt', { time: formatDateTime(receipt.acknowledgedAt) })}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t('announcements.ackHint')}</p>
              {failure && <FormAlert>{failure}</FormAlert>}
              <Button
                className="self-start"
                disabled={acknowledge.isPending}
                onClick={async () => {
                  setFailure(null);
                  try {
                    await acknowledge.mutateAsync();
                    toast.add({ title: t('announcements.acknowledged'), type: 'success' });
                    onAcknowledged?.();
                  } catch (error) {
                    setFailure(errorMessage(t, error));
                  }
                }}
              >
                <CheckIcon />
                {t('announcements.acknowledge')}
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
