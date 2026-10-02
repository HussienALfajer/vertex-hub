import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  calendarDay,
  isTaskFinished,
  SHOOT_DEPARTMENT,
  type TaskDetail,
} from '@vertex-hub/contracts';
import { Button, Skeleton } from '@vertex-hub/ui';
import { CameraIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { can, scopesOf, useMe } from '../../lib/auth';
import { formatWeekdayDate } from '../../lib/format';
import { clientQuery } from '../clients/clients.queries';
import { PersonName } from '../projects/project-badges';
import { TaskSection } from '../tasks/task-parts';
import { shootListQuery } from './calendar.queries';
import { canBookShootsOf, formatTimeRange, ShootStatusBadge } from './calendar-parts';

/**
 * The Shoot panel of the task page (spec F11, screen 7): the task's shoot with its time, place
 * and lead, or "Book shoot" on an open Photography task without an active shoot (rule 2), for
 * those with shoot scope on its client.
 */
export function TaskShootSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const shoots = useQuery(shootListQuery({ taskId: task.id, pageSize: 20 }));
  // An account manager's scope depends on whose client it is, which the task does not carry.
  const ownClients =
    !scopesOf(me, 'shoots.manage').includes('all') && can(me, 'shoots.manage') && !!task.client;
  const client = useQuery({ ...clientQuery(task.client?.id ?? ''), enabled: ownClients });

  // Latest first: the active shoot if there is one, else the last one (closed or cancelled).
  const items = shoots.data?.items ?? [];
  const shoot = items.find((item) => item.status !== 'cancelled') ?? items[0];
  const bookable =
    task.department === SHOOT_DEPARTMENT &&
    !isTaskFinished(task.status) &&
    task.status !== 'cancelled' &&
    task.archivedAt === null &&
    task.postId === null &&
    (!shoot || shoot.status === 'cancelled');
  const mayBook =
    bookable &&
    canBookShootsOf(me, ownClients ? (client.data?.accountManager.id ?? null) : null) &&
    (!ownClients || !!client.data);

  if (shoots.isPending) {
    return task.department === SHOOT_DEPARTMENT ? <Skeleton className="h-32" /> : null;
  }
  if (!shoot && !mayBook) return null;

  return (
    <TaskSection title={t('calendar.taskPanel.title')}>
      {shoot && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link
              to="/shoots/$shootId"
              params={{ shootId: shoot.id }}
              className="min-w-0 truncate font-medium hover:underline"
            >
              {shoot.title}
            </Link>
            <ShootStatusBadge status={shoot.status} />
          </div>
          <dl className="flex flex-col gap-2">
            <Row label={t('calendar.shoot.time')}>
              <span className="tabular-nums">
                {formatWeekdayDate(calendarDay(shoot.startsAt))} · {formatTimeRange(shoot)}
              </span>
            </Row>
            <Row label={t('calendar.shoot.location')}>{shoot.location}</Row>
            <Row label={t('calendar.shoot.lead')}>
              <PersonName name={shoot.lead.name} archived={shoot.lead.archived} />
            </Row>
          </dl>
        </div>
      )}
      {mayBook && (
        <div>
          <Button
            variant={shoot ? 'outline' : 'primary'}
            size="sm"
            render={<Link to="/shoots/new" search={{ taskId: task.id }} />}
          >
            <CameraIcon />
            {shoot ? t('calendar.taskPanel.bookAgain') : t('calendar.actions.bookShoot')}
          </Button>
        </div>
      )}
    </TaskSection>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-end font-medium">{children}</dd>
    </div>
  );
}
