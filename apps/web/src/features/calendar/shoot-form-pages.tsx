import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button, Callout, PageHeader, Skeleton } from '@vertex-hub/ui';
import { ArrowRightIcon, LockIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isMissing, LoadError } from '../../components/load-error';
import { idParam } from '../../lib/search-params';
import { taskQuery } from '../tasks/tasks.queries';
import { shootQuery } from './calendar.queries';
import { ShootForm } from './shoot-form';

export interface NewShootSearch {
  /** Books the shoot from this task, which fixes its client (rule 2). */
  taskId?: string;
}

export function parseNewShootSearch(search: Record<string, unknown>): NewShootSearch {
  return { taskId: idParam(search.taskId) };
}

const FormSkeleton = () => (
  <div className="flex max-w-4xl flex-col gap-6">
    <Skeleton className="h-64" />
    <Skeleton className="h-48" />
    <Skeleton className="h-48" />
  </div>
);

/** Booking a shoot (spec F11, screen 2): from a task (`?taskId=`) or with the task picked here. */
export function NewShootPage({ search }: { search: NewShootSearch }) {
  const { t } = useTranslation();
  const task = useQuery({ ...taskQuery(search.taskId ?? ''), enabled: !!search.taskId });
  return (
    <>
      <PageHeader
        title={t('calendar.new.title')}
        description={t('calendar.new.subtitle')}
        actions={
          <Button
            variant="ghost"
            render={
              search.taskId ? (
                <Link to="/tasks/$taskId" params={{ taskId: search.taskId }} />
              ) : (
                <Link to="/calendar" />
              )
            }
          >
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('calendar.new.back')}
          </Button>
        }
      />
      {!search.taskId ? (
        <ShootForm />
      ) : task.isPending ? (
        <FormSkeleton />
      ) : task.isError ? (
        <LoadError
          message={isMissing(task.error) ? t('tasks.page.notFound') : t('tasks.page.loadError')}
          onRetry={() => task.refetch()}
          error={task.error}
        />
      ) : (
        <ShootForm task={task.data} />
      )}
    </>
  );
}

/** Editing a scheduled shoot (rule 8); any other shoot is read-only and says so. */
export function EditShootPage({ shootId }: { shootId: string }) {
  const { t } = useTranslation();
  const shoot = useQuery(shootQuery(shootId));
  return (
    <>
      <PageHeader
        title={t('calendar.edit.title')}
        description={shoot.data?.title}
        actions={
          <Button variant="ghost" render={<Link to="/shoots/$shootId" params={{ shootId }} />}>
            <ArrowRightIcon className="ltr:-scale-x-100" />
            {t('calendar.edit.back')}
          </Button>
        }
      />
      {shoot.isPending ? (
        <FormSkeleton />
      ) : shoot.isError ? (
        <LoadError
          message={
            isMissing(shoot.error) ? t('calendar.shoot.notFound') : t('calendar.shoot.loadError')
          }
          onRetry={() => shoot.refetch()}
          error={shoot.error}
        />
      ) : shoot.data.permissions.canEdit ? (
        <ShootForm shoot={shoot.data} />
      ) : (
        <Callout
          icon={<LockIcon />}
          title={t('calendar.edit.lockedTitle')}
          description={t('calendar.edit.lockedBody')}
        />
      )}
    </>
  );
}
