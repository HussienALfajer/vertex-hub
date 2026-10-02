import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TaskDetail } from '@vertex-hub/contracts';
import { Badge, Button, Callout, Skeleton, toast } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BanIcon,
  HistoryIcon,
  LockIcon,
  ReceiptTextIcon,
  StethoscopeIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import { formatCalendarDate, formatDateTime, formatNumber } from '../../lib/format';
import { ClientApprovalSection } from '../approvals/task-approval-panel';
import { TaskShootSection } from '../calendar/task-shoot-section';
import { TaskPostSection } from '../content/task-post-section';
import { PersonName, useDepartmentNames } from '../projects/project-badges';
import { lineName } from '../retainers/retainer-badges';
import { TaskTemplateOrigin } from '../templates/template-runs';
import { TaskActions } from './task-actions';
import {
  BlockedBadge,
  formatDue,
  NotInDepartmentBadge,
  OverLimitBadge,
  PriorityBadge,
  TaskArchivedBadge,
  TaskOverdueBadge,
  TaskStatusBadge,
} from './task-badges';
import { CommentsSection } from './task-comments';
import { TaskFilesSection } from './task-files';
import { ChecklistSection, DependenciesSection, LinksSection, TaskSection } from './task-parts';
import { ClientResponsesSection, ClientTextSection, ReviewHistorySection } from './task-review';
import { RevisionsSection } from './task-revisions';
import { taskQuery, useRestoreTask } from './tasks.queries';

export function TaskPage({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const task = useQuery(taskQuery(taskId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/tasks" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('tasks.page.back')}
        </Button>
      </div>
      {task.isPending ? (
        <PageSkeleton />
      ) : task.isError ? (
        <LoadError
          message={isMissing(task.error) ? t('tasks.page.notFound') : t('tasks.page.loadError')}
          onRetry={() => task.refetch()}
          error={task.error}
        />
      ) : (
        <TaskView task={task.data} />
      )}
    </>
  );
}

function TaskView({ task }: { task: TaskDetail }) {
  return (
    <>
      <TaskHero task={task} />
      <Banners task={task} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <BriefSection task={task} />
          {(task.client || task.clientText) && <ClientTextSection task={task} />}
          <TaskFilesSection task={task} />
          <ChecklistSection task={task} />
          <ReviewHistorySection task={task} />
          <ClientResponsesSection task={task} />
          <RevisionsSection task={task} />
          <CommentsSection task={task} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {task.postId && <TaskPostSection postId={task.postId} />}
          <TaskShootSection task={task} />
          <ClientApprovalSection task={task} />
          <DetailsSection task={task} />
          <DependenciesSection task={task} />
          <LinksSection task={task} />
        </div>
      </div>
    </>
  );
}

/** Who does what by when, with the moves the caller may make now. */
function TaskHero({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const departmentName = useDepartmentNames();
  const archived = task.archivedAt !== null;
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {task.client ? (
              <Link
                to="/clients/$clientId"
                params={{ clientId: task.client.id }}
                className="hover:text-foreground hover:underline"
              >
                {task.client.name}
              </Link>
            ) : (
              <span>{t('tasks.internal')}</span>
            )}
            {task.project && (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: task.project.id }}
                  className="hover:text-foreground hover:underline"
                >
                  {task.milestone
                    ? `${task.project.name} · ${task.milestone.name}`
                    : task.project.name}
                </Link>
              </>
            )}
            {task.retainer && (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  to="/retainers/$retainerId"
                  params={{ retainerId: task.retainer.id }}
                  className="hover:text-foreground hover:underline"
                >
                  {task.cycleLine
                    ? `${task.retainer.name} · ${lineName(t, task.cycleLine)}`
                    : task.retainer.name}
                </Link>
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{task.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={task.status} stage={task.reviewStage} />
            <PriorityBadge priority={task.priority} />
            {task.type === 'client_request' && (
              <Badge tone="gold">{t('tasks.types.client_request')}</Badge>
            )}
            {task.overdue && <TaskOverdueBadge />}
            {task.blocked && <BlockedBadge />}
            {task.overLimitPending && <OverLimitBadge />}
            {archived && <TaskArchivedBadge />}
          </div>
        </div>
        <TaskActions task={task} />
      </div>
      <dl className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('tasks.page.assignee')}>
          {task.assignee ? (
            <span className="flex flex-wrap items-center gap-2">
              <Link
                to="/team/$userId"
                params={{ userId: task.assignee.id }}
                className="font-medium hover:underline"
              >
                <PersonName name={task.assignee.name} archived={task.assignee.archived} />
              </Link>
              {!task.assignee.inDepartment && <NotInDepartmentBadge />}
            </span>
          ) : (
            <span className="text-muted-foreground">{t('tasks.unassigned')}</span>
          )}
        </Fact>
        <Fact label={t('tasks.page.department')}>{departmentName(task.department)}</Fact>
        <Fact label={t('tasks.page.due')}>
          <span className="tabular-nums">{formatDue(task)}</span>
        </Fact>
        <Fact label={t('tasks.page.createdBy')}>
          <span>
            {task.createdBy?.name ?? t('tasks.page.createdBySystem')}
            <span className="block text-xs text-muted-foreground">
              {formatDateTime(task.createdAt)}
            </span>
          </span>
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Cancelled, archived, read-only and medical-stage tasks say so above everything else. */
function Banners({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  if (task.archivedAt) return <ArchivedCallout task={task} />;
  if (task.readOnly) {
    return (
      <Callout
        icon={<LockIcon />}
        title={t('tasks.page.readOnlyTitle')}
        description={t('tasks.page.readOnlyBody')}
      />
    );
  }
  if (task.reviewStage === 'medical') {
    // Rule 4: a medical reviewer never reviews their own task.
    const own = can(me, 'approvals.review_medical') && task.assignee?.id === me.user.id;
    return (
      <Callout
        tone="info"
        icon={<StethoscopeIcon />}
        title={t('tasks.page.medicalTitle')}
        description={own ? t('tasks.page.medicalOwnBody') : t('tasks.page.medicalBody')}
      />
    );
  }
  if (task.status !== 'cancelled') return null;
  return (
    <Callout
      tone="danger"
      icon={<BanIcon />}
      title={
        task.cancelledAt
          ? t('tasks.page.cancelledTitle', { date: formatDateTime(task.cancelledAt) })
          : t('tasks.statuses.cancelled')
      }
      description={
        task.cancelReason
          ? t('tasks.page.cancelReason', { reason: task.cancelReason })
          : t('tasks.page.cancelledBody')
      }
    />
  );
}

function ArchivedCallout({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const restore = useRestoreTask(task.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Callout
        icon={<ArchiveIcon />}
        title={t('tasks.page.archivedTitle')}
        description={t('tasks.page.archivedBody')}
        action={
          task.permissions.canArchive && (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <ArchiveRestoreIcon />
              {t('tasks.actions.restore')}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('tasks.restore.title', { title: task.title })}
        body={t('tasks.restore.body')}
        action={t('tasks.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync(undefined);
          toast.add({ title: t('tasks.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

function BriefSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  return (
    <TaskSection title={t('tasks.page.brief')}>
      {task.brief ? (
        <p className="max-w-prose text-base whitespace-pre-line">{task.brief}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('tasks.page.noBrief')}</p>
      )}
    </TaskSection>
  );
}

/** The task's settings: client approval, revision limit, the client request and its extra work. */
function DetailsSection({ task }: { task: TaskDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const request = task.clientRequest;
  return (
    <TaskSection
      title={t('tasks.page.details')}
      action={
        can(me, 'audit.read') && (
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/audit" search={{ entityId: task.id }} />}
          >
            <HistoryIcon />
            {t('tasks.page.auditTrail')}
          </Button>
        )
      }
    >
      <TaskTemplateOrigin taskId={task.id} />
      <dl className="flex flex-col gap-3 text-sm">
        {task.client && (
          <>
            <Row label={t('tasks.form.needsClientApproval')}>
              {task.needsClientApproval ? t('common.yes') : t('common.no')}
            </Row>
            <Row label={t('tasks.form.revisionLimit')}>
              {t('tasks.revisionsCount', {
                used: formatNumber(task.revisions.clientCount),
                limit: formatNumber(task.revisions.limit),
              })}
            </Row>
          </>
        )}
        {request && (
          <>
            <Row label={t('tasks.form.requestedBy')}>
              {request.contact?.name ?? t('common.none')}
            </Row>
            <Row label={t('tasks.form.requestedOn')}>{formatCalendarDate(request.requestedOn)}</Row>
            <Row label={t('tasks.form.requestScope')}>
              {t(`tasks.requestScopes.${request.scope}`)}
            </Row>
            {request.extraWork && (
              <Row label={t('tasks.page.extraWork')}>
                <span className="flex items-center gap-1.5">
                  <ReceiptTextIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  {request.extraWork.title}
                </span>
              </Row>
            )}
          </>
        )}
        {task.startedAt && (
          <Row label={t('tasks.page.startedAt')}>{formatDateTime(task.startedAt)}</Row>
        )}
        {task.deliveredAt && (
          <Row label={t('tasks.page.deliveredAt')}>{formatDateTime(task.deliveredAt)}</Row>
        )}
      </dl>
    </TaskSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium">{children}</dd>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-6 w-56" />
        <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}
