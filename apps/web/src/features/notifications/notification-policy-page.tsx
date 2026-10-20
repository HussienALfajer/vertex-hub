import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  CHANNEL_MODES,
  type ChannelMode,
  NOTIFICATION_CATEGORIES,
  type NotificationPolicy,
  PUSH_DELIVERY_STATUSES,
  type PushDeliveryStatus,
} from '@vertex-hub/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  PageHeader,
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
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from '@vertex-hub/ui';
import { RotateCcwIcon, SendIcon, SlidersHorizontalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { dayParam, idParam, listParam, oneOfParam, pageParam } from '../../lib/search-params';
import { PRIORITY_TONES } from './notification-settings-page';
import { notificationPoliciesQuery, useUpdateNotificationPolicy } from './notifications.queries';
import { PushDeliveriesTab } from './push-deliveries-tab';

const TABS = ['policy', 'deliveries'] as const;

type PolicyTab = (typeof TABS)[number];

export interface NotificationPolicySearch {
  /** The policy table when left out. */
  tab?: 'deliveries';
  /* The delivery log's filters (rule A15). */
  userId?: string;
  status?: PushDeliveryStatus[];
  from?: string;
  to?: string;
  page?: number;
}

export function parseNotificationPolicySearch(
  search: Record<string, unknown>,
): NotificationPolicySearch {
  return {
    tab: oneOfParam(['deliveries'] as const, search.tab),
    userId: idParam(search.userId),
    status: listParam(PUSH_DELIVERY_STATUSES, search.status),
    from: dayParam(search.from),
    to: dayParam(search.to),
    page: pageParam(search.page),
  };
}

/**
 * F16 screen 6 (`notifications.policy`): the push and email mode of every type, grouped by
 * category, saved per row (rules B1–B2), and the push delivery log (rule A15).
 */
export function NotificationPolicyPage({ search }: { search: NotificationPolicySearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/admin/notification-policy' });
  const tab: PolicyTab = search.tab ?? 'policy';

  return (
    <>
      <PageHeader
        title={t('notifications.policy.title')}
        description={t('notifications.policy.subtitle')}
      />
      <Tabs
        value={tab}
        // A tab starts without the other's filters.
        onValueChange={(next: PolicyTab) =>
          navigate({ search: next === 'policy' ? {} : { tab: next } })
        }
      >
        <TabsList aria-label={t('notifications.policy.title')}>
          <TabsTrigger value="policy">
            <SlidersHorizontalIcon />
            {t('notifications.policy.tabs.policy')}
          </TabsTrigger>
          <TabsTrigger value="deliveries">
            <SendIcon />
            {t('notifications.policy.tabs.deliveries')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'policy' ? <PolicyTable /> : <PushDeliveriesTab search={search} />}
    </>
  );
}

function PolicyTable() {
  const { t } = useTranslation();
  const policies = useQuery(notificationPoliciesQuery);
  if (policies.isPending) {
    return (
      <div className="flex flex-col gap-6">
        {['a', 'b', 'c'].map((card) => (
          <Skeleton key={card} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  if (policies.isError) {
    return (
      <LoadError message={t('notifications.policy.loadError')} onRetry={() => policies.refetch()} />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {NOTIFICATION_CATEGORIES.map((category) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle>{t(`notifications.categories.${category}`)}</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('notifications.policy.columns.type')}</TableHead>
                <TableHead>{t('notifications.policy.columns.priority')}</TableHead>
                <TableHead>{t('notifications.policy.columns.push')}</TableHead>
                <TableHead>{t('notifications.policy.columns.email')}</TableHead>
                <TableHead>
                  <span className="sr-only">{t('notifications.policy.reset')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {policies.data.items
                .filter((policy) => policy.category === category)
                .map((policy) => (
                  <PolicyRow key={policy.type} policy={policy} />
                ))}
            </TableBody>
          </Table>
        </Card>
      ))}
    </div>
  );
}

function PolicyRow({ policy }: { policy: NotificationPolicy }) {
  const { t } = useTranslation();
  const update = useUpdateNotificationPolicy();
  const name = t(`notifications.types.${policy.type}`);
  // Shows the change at once; a failed save falls back to the stored modes.
  const pending =
    update.isPending && 'push' in update.variables.input ? update.variables.input : null;
  const push = pending?.push ?? policy.push;
  const email = pending?.email ?? policy.email;
  const changed = policy.push !== policy.defaults.push || policy.email !== policy.defaults.email;

  function save(input: { push: ChannelMode; email: ChannelMode } | { reset: true }) {
    update.mutate(
      { type: policy.type, input },
      {
        onSuccess: () =>
          toast.add({ title: t('notifications.policy.saved', { name }), type: 'success' }),
        onError: (error) => toast.add({ title: errorMessage(t, error), type: 'error' }),
      },
    );
  }

  return (
    <TableRow>
      <TableCell className="min-w-48 whitespace-normal">
        <span className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 font-medium">
            {name}
            {changed && <Badge tone="info">{t('notifications.policy.changed')}</Badge>}
          </span>
          {changed && policy.updatedBy && policy.updatedAt && (
            <span className="text-xs text-muted-foreground">
              {t('notifications.policy.changedBy', {
                name: policy.updatedBy.name,
                time: formatDateTime(policy.updatedAt),
              })}
            </span>
          )}
        </span>
      </TableCell>
      <TableCell>
        <Badge tone={PRIORITY_TONES[policy.priority]}>
          {t(`notifications.priorities.${policy.priority}`)}
        </Badge>
      </TableCell>
      <TableCell>
        <ModeSelect
          label={t('notifications.policy.pushLabel', { name })}
          value={push}
          defaultMode={policy.defaults.push}
          disabled={update.isPending}
          onChange={(mode) => save({ push: mode, email })}
        />
      </TableCell>
      <TableCell>
        <ModeSelect
          label={t('notifications.policy.emailLabel', { name })}
          value={email}
          defaultMode={policy.defaults.email}
          disabled={update.isPending}
          onChange={(mode) => save({ push, email: mode })}
        />
      </TableCell>
      <TableCell>
        {changed && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('notifications.policy.resetLabel', { name })}
            disabled={update.isPending}
            focusableWhenDisabled
            onClick={() => save({ reset: true })}
          >
            <RotateCcwIcon />
            {t('notifications.policy.reset')}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/** A channel's mode, the catalog default marked. */
function ModeSelect({
  label,
  value,
  defaultMode,
  disabled,
  onChange,
}: {
  label: string;
  value: ChannelMode;
  defaultMode: ChannelMode;
  disabled: boolean;
  onChange: (mode: ChannelMode) => void;
}) {
  const { t } = useTranslation();
  const items = CHANNEL_MODES.map((mode) => {
    const modeName = t(`notifications.policy.modes.${mode}`);
    return {
      value: mode,
      label:
        mode === defaultMode ? t('notifications.policy.defaultMode', { mode: modeName }) : modeName,
    };
  });
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next && next !== value) onChange(next as ChannelMode);
      }}
    >
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
