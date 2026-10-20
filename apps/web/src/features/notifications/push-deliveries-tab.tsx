import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  PUSH_DELIVERY_STATUSES,
  type PushDelivery,
  type PushDeliveryStatus,
} from '@vertex-hub/contracts';
import {
  Badge,
  type BadgeProps,
  Button,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { FilterXIcon, SendIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatDateTime, formatNumber } from '../../lib/format';
import { ALL } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useDepartmentNames } from '../projects/project-badges';
import { userListQuery } from '../users/users.queries';
import { notificationText } from './notification-content';
import type { NotificationPolicySearch } from './notification-policy-page';
import { pushDeliveryListQuery } from './notifications.queries';

const PAGE_SIZE = 30;

const STATUS_TONES: Record<PushDeliveryStatus, BadgeProps['tone']> = {
  queued: 'neutral',
  sent: 'success',
  gone: 'warning',
  failed: 'danger',
};

/**
 * F16 rule A15: the pushes of the last 30 days, by user, status and date, to answer "it did not
 * reach me".
 */
export function PushDeliveriesTab({ search }: { search: NotificationPolicySearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/admin/notification-policy' });
  const page = search.page ?? 1;
  const deliveries = useQuery(
    pushDeliveryListQuery({
      userId: search.userId,
      status: search.status,
      from: search.from,
      to: search.to,
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    deliveries.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );
  const setFilter = (next: Partial<NotificationPolicySearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next, page: undefined }), replace: true });

  return (
    <>
      <p className="text-sm text-muted-foreground">{t('notifications.deliveries.hint')}</p>
      <Filters search={search} onChange={setFilter} />
      {deliveries.isPending ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          {['a', 'b', 'c', 'd', 'e'].map((row) => (
            <Skeleton key={row} className="h-8" />
          ))}
        </div>
      ) : deliveries.isError ? (
        <LoadError
          message={t('notifications.deliveries.loadError')}
          onRetry={() => deliveries.refetch()}
        />
      ) : deliveries.data.items.length === 0 ? (
        <EmptyState
          icon={<SendIcon />}
          title={t('notifications.deliveries.emptyTitle')}
          description={t('notifications.deliveries.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <DeliveryTable deliveries={deliveries.data.items} />
          <Pagination
            page={page}
            pageCount={Math.ceil(deliveries.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + deliveries.data.items.length),
              total: formatNumber(deliveries.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}

function Filters({
  search,
  onChange,
}: {
  search: NotificationPolicySearch;
  onChange: (next: Partial<NotificationPolicySearch>) => void;
}) {
  const { t } = useTranslation();
  const users = useQuery(userListQuery({ pageSize: 100 }));
  const userItems = [
    { value: ALL, label: t('notifications.deliveries.allUsers') },
    ...(users.data?.items ?? []).map((user) => ({ value: user.id, label: user.name })),
  ];
  const filtered = !!(search.userId || search.status || search.from || search.to);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
      <ToggleGroup
        multiple
        aria-label={t('notifications.deliveries.status')}
        value={search.status ?? []}
        onValueChange={(next) =>
          onChange({ status: next.length > 0 ? (next as PushDeliveryStatus[]) : undefined })
        }
      >
        {PUSH_DELIVERY_STATUSES.map((status) => (
          <ToggleGroupItem key={status} value={status}>
            {t(`notifications.deliveries.statuses.${status}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:items-end">
        <Field>
          <FieldLabel>{t('notifications.deliveries.user')}</FieldLabel>
          <Select
            items={userItems}
            value={search.userId ?? ALL}
            onValueChange={(next) => onChange({ userId: next && next !== ALL ? next : undefined })}
          >
            <SelectTrigger className="min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {userItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>{t('notifications.deliveries.from')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={search.from ?? ''}
            max={search.to}
            onChange={(event) => onChange({ from: event.target.value || undefined })}
          />
        </Field>
        <Field>
          <FieldLabel>{t('notifications.deliveries.to')}</FieldLabel>
          <Input
            type="date"
            dir="ltr"
            value={search.to ?? ''}
            min={search.from}
            onChange={(event) => onChange({ to: event.target.value || undefined })}
          />
        </Field>
        <Button
          variant="ghost"
          disabled={!filtered}
          focusableWhenDisabled
          onClick={() =>
            onChange({ userId: undefined, status: undefined, from: undefined, to: undefined })
          }
        >
          <FilterXIcon />
          {t('notifications.deliveries.clear')}
        </Button>
      </div>
    </div>
  );
}

function DeliveryTable({ deliveries }: { deliveries: PushDelivery[] }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('notifications.deliveries.columns.time')}</TableHead>
          <TableHead>{t('notifications.deliveries.columns.user')}</TableHead>
          <TableHead>{t('notifications.deliveries.columns.text')}</TableHead>
          <TableHead>{t('notifications.deliveries.columns.status')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery) => (
          <TableRow key={delivery.id}>
            <TableCell className="min-w-36 whitespace-normal">
              {formatDateTime(delivery.createdAt)}
            </TableCell>
            <TableCell className="whitespace-normal">
              <span className="flex flex-col">
                <span className="font-medium">{delivery.user.name}</span>
                <span className="text-xs text-muted-foreground">{delivery.device}</span>
              </span>
            </TableCell>
            <TableCell className="max-w-96 min-w-48 whitespace-normal">
              {delivery.kind !== 'notification' ? (
                t(`notifications.deliveries.kinds.${delivery.kind}`)
              ) : delivery.notification ? (
                notificationText(delivery.notification, departmentName).text
              ) : (
                <span className="text-muted-foreground">
                  {t('notifications.deliveries.purged')}
                </span>
              )}
            </TableCell>
            <TableCell className="whitespace-normal">
              <span className="flex max-w-56 min-w-28 flex-col items-start gap-1">
                <Badge tone={STATUS_TONES[delivery.status]}>
                  {t(`notifications.deliveries.statuses.${delivery.status}`)}
                </Badge>
                {delivery.sentAt && (
                  <span className="text-xs text-muted-foreground">
                    {t('notifications.deliveries.sentAt', {
                      time: formatDateTime(delivery.sentAt),
                    })}
                  </span>
                )}
                {delivery.clickedAt && (
                  <span className="text-xs text-muted-foreground">
                    {t('notifications.deliveries.clickedAt', {
                      time: formatDateTime(delivery.clickedAt),
                    })}
                  </span>
                )}
                {delivery.error && (
                  <span className="text-xs text-destructive-text" dir="auto">
                    {delivery.error}
                  </span>
                )}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
