import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  ATTENDANCE_ITEM_KINDS,
  type AttendanceItemKind,
  HR_REQUEST_KINDS,
  type HrRequestKind,
  type MeResponse,
} from '@vertex-hub/contracts';
import {
  EmptyState,
  PageHeader,
  Pagination,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import { ClipboardListIcon, StampIcon, TimerIcon } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { can } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { ALL, idParam, oneOfParam, pageParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { departmentListQuery } from '../departments/departments.queries';
import { ChoiceSelect } from '../quotes/choice-select';
import { hrRequestListQuery } from './hr.queries';
import { ItemApprovals } from './item-approvals';
import { RequestRows, RequestRowsSkeleton } from './leave-parts';

/** Approvals reach `hr.read` holders: the GM decides, managers and Ops give opinions (B14). */
export const readsHr = (me: MeResponse) => can(me, 'hr.read');

const APPROVAL_VIEWS = ['requests', 'items'] as const;

type ApprovalView = (typeof APPROVAL_VIEWS)[number];

export interface HrApprovalsSearch {
  /** Unset means the requests. */
  view?: ApprovalView;
  kind?: HrRequestKind;
  itemKind?: AttendanceItemKind;
  departmentId?: string;
  page?: number;
}

export function parseHrApprovalsSearch(search: Record<string, unknown>): HrApprovalsSearch {
  return {
    view: oneOfParam(APPROVAL_VIEWS, search.view),
    kind: oneOfParam(HR_REQUEST_KINDS, search.kind),
    itemKind: oneOfParam(ATTENDANCE_ITEM_KINDS, search.itemKind),
    departmentId: idParam(search.departmentId),
    page: pageParam(search.page),
  };
}

const PAGE_SIZE = 25;

/**
 * Approvals `/hr/approvals` (spec F17): the pending requests and attendance items in the
 * viewer's scope, oldest first, filtered by kind and department.
 */
export function HrApprovalsPage({ search }: { search: HrApprovalsSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/hr/approvals' });
  const page = search.page ?? 1;
  const view = search.view ?? 'requests';
  const departments = useQuery(departmentListQuery);
  const requests = useQuery({
    ...hrRequestListQuery({
      status: ['pending'],
      kind: search.kind,
      departmentId: search.departmentId,
      order: 'asc',
      page,
      pageSize: PAGE_SIZE,
    }),
    enabled: view === 'requests',
  });
  usePageInRange(
    page,
    requests.data?.total,
    PAGE_SIZE,
    useCallback(
      (next: number | undefined) =>
        navigate({ search: (previous) => ({ ...previous, page: next }), replace: true }),
      [navigate],
    ),
  );
  const setFilter = (next: Partial<HrApprovalsSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...next, page: undefined }), replace: true });

  const kindItems = [
    { value: ALL, label: t('hr.approvals.allKinds') },
    ...(view === 'items'
      ? ATTENDANCE_ITEM_KINDS.map((kind) => ({ value: kind, label: t(`hr.items.kinds.${kind}`) }))
      : HR_REQUEST_KINDS.map((kind) => ({ value: kind, label: t(`hr.requests.kinds.${kind}`) }))),
  ];
  const departmentItems = [
    { value: ALL, label: t('users.allDepartments') },
    ...(departments.data?.items ?? [])
      .filter((d) => !d.archivedAt || d.id === search.departmentId)
      .map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    <>
      <PageHeader title={t('hr.approvals.title')} description={t('hr.approvals.subtitle')} />
      <Tabs
        value={view}
        onValueChange={(next: ApprovalView) =>
          navigate({
            search: (previous) => ({
              departmentId: previous.departmentId,
              view: next === 'requests' ? undefined : next,
            }),
            replace: true,
          })
        }
      >
        <TabsList aria-label={t('hr.approvals.title')}>
          <TabsTrigger value="requests">
            <ClipboardListIcon />
            {t('hr.approvals.views.requests')}
          </TabsTrigger>
          <TabsTrigger value="items">
            <TimerIcon />
            {t('hr.approvals.views.items')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="requests" />
        <TabsContent value="items" />
      </Tabs>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 md:flex-row md:items-center">
        <ChoiceSelect
          label={t('hr.approvals.kind')}
          items={kindItems}
          value={(view === 'items' ? search.itemKind : search.kind) ?? ALL}
          onChange={(value) =>
            setFilter(
              view === 'items'
                ? { itemKind: value === ALL ? undefined : (value as AttendanceItemKind) }
                : { kind: value === ALL ? undefined : (value as HrRequestKind) },
            )
          }
          className="md:w-48"
        />
        <ChoiceSelect
          label={t('users.department')}
          items={departmentItems}
          value={search.departmentId ?? ALL}
          onChange={(value) => setFilter({ departmentId: value === ALL ? undefined : value })}
          className="md:w-48"
        />
      </div>
      {view === 'items' ? (
        <ItemApprovals
          kind={search.itemKind}
          departmentId={search.departmentId}
          page={page}
          onPageChange={(next) => navigate({ search: (previous) => ({ ...previous, page: next }) })}
        />
      ) : requests.isPending ? (
        <RequestRowsSkeleton />
      ) : requests.isError ? (
        <LoadError message={t('hr.requests.listError')} onRetry={() => requests.refetch()} />
      ) : requests.data.items.length === 0 ? (
        <EmptyState
          icon={<StampIcon />}
          title={t('hr.approvals.emptyTitle')}
          description={t('hr.approvals.emptyHint')}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <RequestRows requests={requests.data.items} showUser from="approvals" />
          <Pagination
            page={page}
            pageCount={Math.ceil(requests.data.total / PAGE_SIZE)}
            onPageChange={(next) =>
              navigate({ search: (previous) => ({ ...previous, page: next }) })
            }
            summary={t('common.pageSummary', {
              from: formatNumber((page - 1) * PAGE_SIZE + 1),
              to: formatNumber((page - 1) * PAGE_SIZE + requests.data.items.length),
              total: formatNumber(requests.data.total),
            })}
            previousLabel={t('common.previous')}
            nextLabel={t('common.next')}
          />
        </div>
      )}
    </>
  );
}
