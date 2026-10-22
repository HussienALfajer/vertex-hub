import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  EmptyState,
  PageHeader,
  Pagination,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@vertex-hub/ui';
import {
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  SunIcon,
  WalletCardsIcon,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadError } from '../../components/load-error';
import { useMe } from '../../lib/auth';
import { formatNumber } from '../../lib/format';
import { monthParam, oneOfParam, pageParam } from '../../lib/search-params';
import { usePageInRange } from '../../lib/use-page-in-range';
import { AttendanceMonth, monthOrCurrent } from './attendance-month';
import { PasskeyCard, TodayCard } from './attendance-today';
import { hrRequestListQuery } from './hr.queries';
import { NewRequestDialog } from './leave-dialogs';
import { LeaveBalances, NewRequestButton, RequestRows, RequestRowsSkeleton } from './leave-parts';

const ATTENDANCE_TABS = ['today', 'month', 'balances', 'requests'] as const;

type AttendanceTab = (typeof ATTENDANCE_TABS)[number];

export interface MyAttendanceSearch {
  /** Unset means Today. */
  tab?: AttendanceTab;
  page?: number;
  /** This month's tab: `YYYY-MM`; unset means the current month. */
  month?: string;
}

export function parseMyAttendanceSearch(search: Record<string, unknown>): MyAttendanceSearch {
  return {
    tab: oneOfParam(ATTENDANCE_TABS, search.tab),
    page: pageParam(search.page),
    month: monthParam(search.month),
  };
}

const PAGE_SIZE = 20;

/**
 * My attendance `/me/attendance` (spec F17): Today (the punch buttons and the passkey), This
 * month, the leave balances and the employee's own requests, with "New request" (rules B8–B13,
 * C19). Every user has it; exempt users are told they need not punch.
 */
export function MyAttendancePage({ search }: { search: MyAttendanceSearch }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate({ from: '/me/attendance' });
  const tab = search.tab ?? 'today';
  const [requesting, setRequesting] = useState(false);
  const newButton = useRef<HTMLButtonElement>(null);
  const newRequest = (
    <NewRequestButton
      buttonRef={newButton}
      onClick={() => setRequesting(true)}
      label={t('hr.requests.new.title')}
    />
  );

  return (
    <>
      <PageHeader
        title={t('hr.attendance.title')}
        description={t('hr.attendance.subtitle')}
        actions={newRequest}
      />
      <Tabs
        value={tab}
        onValueChange={(next: AttendanceTab) =>
          navigate({
            search: { tab: next === 'today' ? undefined : next },
            replace: true,
          })
        }
      >
        <TabsList aria-label={t('hr.attendance.title')}>
          <TabsTrigger value="today">
            <SunIcon />
            {t('hr.attendance.tabs.today')}
          </TabsTrigger>
          <TabsTrigger value="month">
            <CalendarDaysIcon />
            {t('hr.attendance.tabs.month')}
          </TabsTrigger>
          <TabsTrigger value="balances">
            <WalletCardsIcon />
            {t('hr.attendance.tabs.balances')}
          </TabsTrigger>
          <TabsTrigger value="requests">
            <ClipboardListIcon />
            {t('hr.attendance.tabs.requests')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr] lg:items-start">
            <TodayCard />
            <PasskeyCard />
          </div>
        </TabsContent>
        <TabsContent value="month">
          <AttendanceMonth
            userId="me"
            month={monthOrCurrent(search.month)}
            onMonthChange={(month) =>
              navigate({ search: (previous) => ({ ...previous, month }), replace: true })
            }
            self
          />
        </TabsContent>
        <TabsContent value="balances">
          <LeaveBalances userId={me.user.id} />
        </TabsContent>
        <TabsContent value="requests">
          <MyRequests search={search} />
        </TabsContent>
      </Tabs>
      <NewRequestDialog
        open={requesting}
        onClose={() => setRequesting(false)}
        finalFocus={() => newButton.current ?? true}
      />
    </>
  );
}

/** The employee's requests, newest first; "New request" stays in the page header. */
function MyRequests({ search }: { search: MyAttendanceSearch }) {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/me/attendance' });
  const page = search.page ?? 1;
  const requests = useQuery(hrRequestListQuery({ userId: 'me', page, pageSize: PAGE_SIZE }));
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

  if (requests.isPending) return <RequestRowsSkeleton />;
  if (requests.isError) {
    return <LoadError message={t('hr.requests.listError')} onRetry={() => requests.refetch()} />;
  }
  if (requests.data.items.length === 0) {
    return (
      <EmptyState
        icon={<CalendarCheckIcon />}
        title={t('hr.requests.emptyTitle')}
        description={t('hr.requests.emptyHint')}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <RequestRows requests={requests.data.items} from="mine" />
      <Pagination
        page={page}
        pageCount={Math.ceil(requests.data.total / PAGE_SIZE)}
        onPageChange={(next) => navigate({ search: (previous) => ({ ...previous, page: next }) })}
        summary={t('common.pageSummary', {
          from: formatNumber((page - 1) * PAGE_SIZE + 1),
          to: formatNumber((page - 1) * PAGE_SIZE + requests.data.items.length),
          total: formatNumber(requests.data.total),
        })}
        previousLabel={t('common.previous')}
        nextLabel={t('common.next')}
      />
    </div>
  );
}
