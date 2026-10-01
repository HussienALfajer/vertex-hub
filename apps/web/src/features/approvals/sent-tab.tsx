import { useQuery } from '@tanstack/react-query';
import { APPROVAL_REQUEST_STATES, type ApprovalRequestState } from '@vertex-hub/contracts';
import {
  EmptyState,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from '@vertex-hub/ui';
import { SendIcon } from 'lucide-react';
import { useCallback, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { formatNumber } from '../../lib/format';
import { ALL } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { useClientOptions } from '../tasks/task-form';
import { RequestsTable } from './approval-parts';
import { approvalRequestListQuery } from './approvals.queries';

export interface SentSearch {
  /** Unset means the requests still waiting: open and expired. */
  state?: ApprovalRequestState[];
  clientId?: string;
  mine?: true;
  page?: number;
}

const PAGE_SIZE = 25;

/** The API's default: the requests that still wait on the client or on the account manager. */
const DEFAULT_STATES: ApprovalRequestState[] = ['open', 'expired'];

/** The approval requests sent to clients (spec F09, screen 1), newest first. */
export function SentTab({
  search,
  onChange,
}: {
  search: SentSearch;
  /** Merges into the URL; a filter change goes back to the first page. */
  onChange: (next: Partial<SentSearch>) => void;
}) {
  const { t } = useTranslation();
  const mineId = useId();
  const clients = useClientOptions();
  const page = search.page ?? 1;
  const requests = useQuery(
    approvalRequestListQuery({
      state: search.state ?? DEFAULT_STATES,
      clientId: search.clientId,
      ...(search.mine && { createdBy: 'me' as const }),
      page,
      pageSize: PAGE_SIZE,
    }),
  );
  usePageInRange(
    page,
    requests.data?.total,
    PAGE_SIZE,
    useCallback((next: number | undefined) => onChange({ page: next }), [onChange]),
  );
  const filtered = !!(search.state || search.clientId || search.mine);
  const clientItems = [
    { value: ALL, label: t('approvals.sent.allClients') },
    ...clients.map((client) => ({ value: client.id, label: client.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
        <ToggleGroup
          multiple
          aria-label={t('approvals.sent.columns.state')}
          value={search.state ?? DEFAULT_STATES}
          onValueChange={(next: ApprovalRequestState[]) => {
            if (next.length === 0) return;
            const isDefault =
              next.length === DEFAULT_STATES.length &&
              DEFAULT_STATES.every((state) => next.includes(state));
            onChange({ state: isDefault ? undefined : next, page: undefined });
          }}
          className="max-w-full overflow-x-auto"
        >
          {APPROVAL_REQUEST_STATES.map((state) => (
            <ToggleGroupItem key={state} value={state}>
              {t(`approvals.states.${state}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select
          items={clientItems}
          value={search.clientId ?? ALL}
          onValueChange={(next) =>
            onChange({ clientId: !next || next === ALL ? undefined : next, page: undefined })
          }
        >
          <SelectTrigger aria-label={t('approvals.sent.client')} className="md:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clientItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor={mineId} className="flex items-center gap-2 text-sm md:ms-auto">
          <Switch
            id={mineId}
            checked={search.mine === true}
            onCheckedChange={(checked) =>
              onChange({ mine: checked ? true : undefined, page: undefined })
            }
          />
          {t('approvals.sent.mine')}
        </label>
      </div>

      {requests.isPending ? (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : requests.isError ? (
        <LoadError message={t('approvals.sent.loadError')} onRetry={() => requests.refetch()} />
      ) : requests.data.items.length === 0 ? (
        <EmptyState
          icon={<SendIcon className="rtl:-scale-x-100" />}
          title={filtered ? t('approvals.sent.noMatchTitle') : t('approvals.sent.emptyTitle')}
          description={filtered ? t('approvals.sent.noMatchHint') : t('approvals.sent.emptyHint')}
        />
      ) : (
        <>
          <RequestsTable requests={requests.data.items} />
          <Pagination
            page={page}
            pageCount={Math.ceil(requests.data.total / PAGE_SIZE)}
            onPageChange={(next) => onChange({ page: next > 1 ? next : undefined })}
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + requests.data.items.length),
              total: formatNumber(requests.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </>
      )}
    </div>
  );
}
