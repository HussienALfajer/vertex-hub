import { useQueryClient } from '@tanstack/react-query';
import type { MeResponse } from '@vertex-hub/contracts';
import { Button, PageHeader } from '@vertex-hub/ui';
import { RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, scopesOf, useMe } from '../../lib/auth';
import { formatTime } from '../../lib/format';
import { reportsKeys } from '../reports/reports.queries';
import { tasksKeys } from '../tasks/tasks.queries';
import { CompanySection } from './company-section';
import { DepartmentsSection } from './departments-section';
import { FinanceSection } from './finance-section';
import { MyClientsSection } from './my-clients-section';
import { MyWorkSection } from './my-work-section';

/** Rule 23 and screen 1: the sections the user can read, in the order of rules 1–5. */
export function dashboardSections(me: MeResponse) {
  const reports = scopesOf(me, 'reports.read');
  return {
    company: reports.includes('all'),
    finance: can(me, 'reports.finance'),
    departments: reports.includes('all') || reports.includes('department'),
    clients: reports.includes('own_clients'),
    work: can(me, 'tasks.read'),
  };
}

/**
 * Screen 1: the home page, one section per role the user holds (owner decision). Every number is
 * computed on read; the refresh asks for all of them again.
 */
export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  const queryClient = useQueryClient();
  const [loadedAt, setLoadedAt] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const show = dashboardSections(me);

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all(
        [reportsKeys.dashboard, tasksKeys.all].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    } finally {
      setLoadedAt(new Date());
      setRefreshing(false);
    }
  }

  return (
    <>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {t('dashboard.loadedAt', { time: formatTime(loadedAt) })}
            </span>
            <Button variant="outline" onClick={refresh} disabled={refreshing} focusableWhenDisabled>
              <RefreshCwIcon
                className={refreshing ? 'animate-spin motion-reduce:animate-none' : ''}
              />
              {t('dashboard.refresh')}
            </Button>
          </div>
        }
      />
      {show.company && <CompanySection />}
      {show.finance && <FinanceSection />}
      {show.departments && <DepartmentsSection />}
      {show.clients && <MyClientsSection />}
      {show.work && <MyWorkSection />}
    </>
  );
}
