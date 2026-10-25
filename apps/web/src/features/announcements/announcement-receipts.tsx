import { useQuery } from '@tanstack/react-query';
import {
  ANNOUNCEMENT_RECEIPT_FILTERS,
  type Announcement,
  type AnnouncementReceiptsQuery,
} from '@vertex-hub/contracts';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
  toast,
} from '@vertex-hub/ui';
import { BellRingIcon, UsersIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormAlert } from '../../components/form-alert';
import { LoadError } from '../../components/load-error';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatNumber } from '../../lib/format';
import { announcementReceiptsQuery, useRemindAnnouncement } from './announcements.queries';

type Filter = AnnouncementReceiptsQuery['filter'];

/**
 * Rule D9: who opened and acknowledged an announcement, for its author and managers, with
 * "Remind those who have not acknowledged now" for the author (rule D8).
 */
export function AnnouncementReceipts({ announcement }: { announcement: Announcement }) {
  const { t } = useTranslation();
  const me = useMe();
  const [filter, setFilter] = useState<Filter>('all');
  const receipts = useQuery(announcementReceiptsQuery(announcement.id, filter));
  const remind = useRemindAnnouncement(announcement.id);
  const [failure, setFailure] = useState<string | null>(null);
  const filters = ANNOUNCEMENT_RECEIPT_FILTERS.filter(
    (value) => value !== 'not_acknowledged' || announcement.requiresAck,
  );
  const canRemind =
    announcement.author.id === me.user.id &&
    announcement.requiresAck &&
    announcement.status === 'sent';
  const totals = receipts.data?.totals ?? announcement.totals;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium">{t('announcements.receipts.title')}</h2>
        {canRemind && (
          <Button
            size="sm"
            variant="outline"
            disabled={remind.isPending || totals?.acknowledged === totals?.recipients}
            focusableWhenDisabled
            onClick={async () => {
              setFailure(null);
              try {
                const result = await remind.mutateAsync();
                toast.add({
                  title: t('announcements.receipts.reminded', {
                    count: result.reminded,
                    n: formatNumber(result.reminded),
                  }),
                  type: 'success',
                });
              } catch (error) {
                setFailure(errorMessage(t, error));
              }
            }}
          >
            <BellRingIcon />
            {t('announcements.receipts.remind')}
          </Button>
        )}
      </div>
      {failure && <FormAlert>{failure}</FormAlert>}
      {totals && (
        <dl className="grid grid-cols-3 gap-3">
          <Total label={t('announcements.receipts.recipients')} value={totals.recipients} />
          <Total label={t('announcements.receipts.opened')} value={totals.opened} />
          {announcement.requiresAck && (
            <Total label={t('announcements.receipts.acknowledged')} value={totals.acknowledged} />
          )}
        </dl>
      )}
      <ToggleGroup
        aria-label={t('announcements.receipts.filter')}
        value={[filter]}
        onValueChange={(next: Filter[]) => next[0] && setFilter(next[0])}
        className="flex-wrap"
      >
        {filters.map((value) => (
          <ToggleGroupItem key={value} value={value}>
            {t(`announcements.receipts.filters.${value}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {receipts.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : receipts.isError ? (
        <LoadError
          message={t('announcements.receipts.loadError')}
          onRetry={() => receipts.refetch()}
        />
      ) : receipts.data.items.length === 0 ? (
        <EmptyState icon={<UsersIcon />} title={t(`announcements.receipts.empty.${filter}`)} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('announcements.receipts.person')}</TableHead>
              <TableHead>{t('announcements.receipts.openedAt')}</TableHead>
              {announcement.requiresAck && (
                <TableHead>{t('announcements.receipts.acknowledgedAt')}</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.data.items.map((item) => (
              <TableRow key={item.user.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Avatar name={item.user.name} size="sm" />
                    {item.user.name}
                    {item.user.archived && (
                      <Badge tone="neutral">{t('announcements.receipts.archived')}</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.openedAt ? formatDateTime(item.openedAt) : t('announcements.receipts.not')}
                </TableCell>
                {announcement.requiresAck && (
                  <TableCell className="text-muted-foreground">
                    {item.acknowledgedAt
                      ? formatDateTime(item.acknowledgedAt)
                      : item.remindersSent > 0
                        ? t('announcements.receipts.reminders', {
                            count: item.remindersSent,
                            n: formatNumber(item.remindersSent),
                          })
                        : t('announcements.receipts.not')}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/60 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{formatNumber(value)}</dd>
    </div>
  );
}
