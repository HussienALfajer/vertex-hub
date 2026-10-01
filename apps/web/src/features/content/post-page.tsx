import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { isPostOpen, POST_LIMITS, type PostDetail } from '@vertex-hub/contracts';
import { Badge, Button, Callout, PlatformMark, Skeleton, toast } from '@vertex-hub/ui';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  BanIcon,
  ExternalLinkIcon,
  HistoryIcon,
  LockIcon,
  PencilIcon,
  StethoscopeIcon,
  TriangleAlertIcon,
  UndoIcon,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { isMissing, LoadError } from '../../components/load-error';
import { can, useMe } from '../../lib/auth';
import {
  formatCalendarDate,
  formatDateTime,
  formatLink,
  formatNumber,
  formatTimeOfDay,
} from '../../lib/format';
import { PersonName } from '../projects/project-badges';
import { lineName } from '../retainers/retainer-badges';
import { TaskSection } from '../tasks/task-parts';
import { postQuery, useRestorePost } from './content.queries';
import { ContentDialog, DetailsDialog, PostActions, PublishedDialog } from './post-actions';
import { PostMediaSection } from './post-media';
import { PostOverdueBadge, PostPlatforms, PostStatusBadge, PostTypeIcon } from './post-parts';
import { PostClientResponsesSection, PostReviewHistorySection } from './post-review';
import { PostTasksSection } from './post-tasks';

/** The post page (spec F08, screen 4). */
export function PostPage({ postId }: { postId: string }) {
  const { t } = useTranslation();
  const post = useQuery(postQuery(postId));
  return (
    <>
      <div>
        <Button variant="ghost" size="sm" render={<Link to="/content" />}>
          <ArrowRightIcon className="ltr:-scale-x-100" />
          {t('content.page.back')}
        </Button>
      </div>
      {post.isPending ? (
        <PageSkeleton />
      ) : post.isError ? (
        <LoadError
          message={isMissing(post.error) ? t('content.page.notFound') : t('content.page.loadError')}
          onRetry={() => post.refetch()}
          error={post.error}
        />
      ) : (
        <PostView post={post.data} />
      )}
    </>
  );
}

function PostView({ post }: { post: PostDetail }) {
  return (
    <>
      <PostHero post={post} />
      <Banners post={post} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <ContentSection post={post} />
          <PostMediaSection post={post} />
          <PostTasksSection post={post} />
          <PostReviewHistorySection post={post} />
          <PostClientResponsesSection post={post} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <ScheduleSection post={post} />
          <PublishingSection post={post} />
        </div>
      </div>
    </>
  );
}

/** What goes out, for whom and when, with the moves the caller may make now. */
function PostHero({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link
              to="/clients/$clientId"
              params={{ clientId: post.client.id }}
              search={{ tab: 'content' }}
              className="hover:text-foreground hover:underline"
            >
              {post.client.name}
            </Link>
            <span aria-hidden="true">·</span>
            <span className="flex items-center gap-1.5">
              <PostTypeIcon type={post.type} />
              {t(`content.types.${post.type}`)}
            </span>
          </p>
          <h1 className="text-2xl font-bold">{post.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <PostStatusBadge status={post.status} stage={post.reviewStage} />
            {post.overdue && <PostOverdueBadge />}
            {post.archivedAt && (
              <Badge tone="neutral">
                <ArchiveIcon aria-hidden="true" />
                {t('content.archivedBadge')}
              </Badge>
            )}
          </div>
        </div>
        <PostActions post={post} />
      </div>
      <dl className="grid gap-4 border-t border-border pt-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Fact label={t('content.page.publish')}>
          <span className="font-medium tabular-nums">
            {formatCalendarDate(post.publishDate)}
            {post.publishTime && (
              <span className="block text-xs font-normal text-muted-foreground">
                {formatTimeOfDay(post.publishTime)}
              </span>
            )}
          </span>
        </Fact>
        <Fact label={t('content.page.platforms')}>
          <PostPlatforms platforms={post.platforms} size="sm" />
        </Fact>
        <Fact label={t('content.page.responsible')}>
          <span className="flex flex-wrap items-center gap-2">
            <Link
              to="/team/$userId"
              params={{ userId: post.responsible.id }}
              className="font-medium hover:underline"
            >
              <PersonName name={post.responsible.name} archived={post.responsible.archived} />
            </Link>
            {!post.responsible.inScope && (
              <Badge tone="warning" title={t('content.page.outOfScopeHint')}>
                <TriangleAlertIcon aria-hidden="true" />
                {t('content.page.outOfScope')}
              </Badge>
            )}
          </span>
        </Fact>
        <Fact label={t('content.page.createdBy')}>
          <span>
            {post.createdBy.name}
            <span className="block text-xs text-muted-foreground">
              {formatDateTime(post.createdAt)}
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

/** What sent the post back last: a review's return or the client asking for changes. */
function latestReturn(post: PostDetail): { note: string | null; by: string; at: string } | null {
  const review = post.reviewHistory.at(-1);
  const response = post.clientResponses.at(-1);
  const reviewLast = !!review && (!response || review.createdAt > response.createdAt);
  if (reviewLast) {
    return review.outcome === 'returned'
      ? { note: review.note, by: review.reviewer?.name ?? '', at: review.createdAt }
      : null;
  }
  return response?.decision === 'changes_requested'
    ? { note: response.note, by: response.contact.name, at: response.createdAt }
    : null;
}

/** Archived, read-only, medical-stage, cancelled and returned posts say so above everything. */
function Banners({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  if (post.archivedAt) return <ArchivedCallout post={post} />;
  if (post.readOnly) {
    return (
      <Callout
        icon={<LockIcon />}
        title={t('tasks.page.readOnlyTitle')}
        description={t('content.page.readOnlyBody')}
      />
    );
  }
  if (post.reviewStage === 'medical') {
    // Rule 13: a medical reviewer never reviews a post they are responsible for.
    const own = can(me, 'approvals.review_medical') && post.responsible.id === me.user.id;
    return (
      <Callout
        tone="info"
        icon={<StethoscopeIcon />}
        title={t('tasks.page.medicalTitle')}
        description={own ? t('content.page.medicalOwnBody') : t('content.page.medicalBody')}
      />
    );
  }
  if (post.status === 'cancelled') {
    return (
      <Callout
        tone="danger"
        icon={<BanIcon />}
        title={
          post.cancelledAt
            ? t('content.page.cancelledTitle', { date: formatDateTime(post.cancelledAt) })
            : t('content.statuses.cancelled')
        }
        description={
          post.cancelReason
            ? t('tasks.page.cancelReason', { reason: post.cancelReason })
            : t('content.page.cancelledBody')
        }
      />
    );
  }
  const returned = post.status === 'in_production' ? latestReturn(post) : null;
  if (!returned) return null;
  return (
    <Callout
      tone="warning"
      icon={<UndoIcon className="rtl:-scale-x-100" />}
      title={t('content.page.returnedTitle', {
        name: returned.by,
        date: formatDateTime(returned.at),
      })}
      description={returned.note ?? t('content.page.returnedBody')}
    />
  );
}

function ArchivedCallout({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const restore = useRestorePost(post.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Callout
        icon={<ArchiveIcon />}
        title={t('content.page.archivedTitle')}
        description={t('content.page.archivedBody')}
        action={
          post.permissions.canArchive && (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              <ArchiveRestoreIcon />
              {t('content.actions.restore')}
            </Button>
          )
        }
      />
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('content.restore.title', { title: post.title })}
        body={t('content.restore.body')}
        action={t('content.actions.restore')}
        pending={restore.isPending}
        onConfirm={async () => {
          await restore.mutateAsync(undefined);
          toast.add({ title: t('content.restore.done'), type: 'success' });
        }}
      />
    </>
  );
}

/** The caption and hashtags with their lengths: what the review and the client approve. */
function ContentSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const count = (text: string | null, max: number) =>
    t('content.page.characters', {
      count: formatNumber(text?.length ?? 0),
      max: formatNumber(max),
    });
  return (
    <TaskSection
      title={t('content.page.content')}
      action={
        post.permissions.canEditContent && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon />
            {t('common.edit')}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('content.form.caption')}</span>
          <span className="tabular-nums">{count(post.caption, POST_LIMITS.caption)}</span>
        </div>
        {post.caption ? (
          <p className="max-w-prose text-base whitespace-pre-line" dir="auto">
            {post.caption}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('content.page.noCaption')}</p>
        )}
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t('content.form.hashtags')}</span>
          <span className="tabular-nums">{count(post.hashtags, POST_LIMITS.hashtags)}</span>
        </div>
        {post.hashtags ? (
          <p className="max-w-prose text-sm whitespace-pre-line" dir="auto">
            {post.hashtags}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('content.page.noHashtags')}</p>
        )}
      </div>
      {post.permissions.canEdit && !post.permissions.canEditContent && isPostOpen(post.status) && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LockIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {t('content.page.contentLocked')}
        </p>
      )}
      {editing && <ContentDialog post={post} onClose={() => setEditing(false)} />}
    </TaskSection>
  );
}

/**
 * When and where the post goes out, who answers for it, whether the client approves it, and the
 * retainer line it counts on (rule 16), with the internal notes.
 */
function ScheduleSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const editable = post.permissions.canEdit && isPostOpen(post.status);
  const countingTask = post.linkedTasks.find((task) => task.cycleLine !== null);
  return (
    <TaskSection
      title={t('content.page.schedule')}
      action={
        editable && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon />
            {t('common.edit')}
          </Button>
        )
      }
    >
      <dl className="flex flex-col gap-3 text-sm">
        <Row label={t('content.form.publishDate')}>{formatCalendarDate(post.publishDate)}</Row>
        <Row label={t('content.form.publishTime')}>
          {post.publishTime ? formatTimeOfDay(post.publishTime) : t('common.none')}
        </Row>
        <Row label={t('content.form.needsClientApproval')}>
          {post.needsClientApproval ? t('common.yes') : t('common.no')}
        </Row>
        <Row label={t('content.page.counting')}>
          {post.cycleLine ? (
            <Link
              to="/retainers/$retainerId"
              params={{ retainerId: post.cycleLine.retainer.id }}
              className="hover:underline"
            >
              {`${lineName(t, post.cycleLine)} · ${post.cycleLine.retainer.name}`}
            </Link>
          ) : countingTask ? (
            t('content.page.countedThrough', { task: countingTask.title })
          ) : (
            <span className="font-normal text-muted-foreground">
              {t('content.page.notCounted')}
            </span>
          )}
        </Row>
      </dl>
      <div className="flex flex-col gap-1 border-t border-border pt-3 text-sm">
        <span className="text-xs text-muted-foreground">{t('content.form.notes')}</span>
        {post.notes ? (
          <p className="whitespace-pre-line">{post.notes}</p>
        ) : (
          <p className="text-muted-foreground">{t('content.page.noNotes')}</p>
        )}
      </div>
      {can(me, 'audit.read') && (
        <div className="border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            render={<Link to="/audit" search={{ entityId: post.id }} />}
          >
            <HistoryIcon />
            {t('tasks.page.auditTrail')}
          </Button>
        </div>
      )}
      {editing && <DetailsDialog post={post} onClose={() => setEditing(false)} />}
    </TaskSection>
  );
}

/** The scheduled mark, then when the post went out and its link on each platform (rule 18). */
function PublishingSection({ post }: { post: PostDetail }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  if (!post.scheduledAt && !post.publishedAt) return null;
  const published = post.status === 'published';
  return (
    <TaskSection
      title={t('content.publishing.title')}
      action={
        published &&
        post.permissions.canEdit && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <PencilIcon />
            {t('common.edit')}
          </Button>
        )
      }
    >
      <dl className="flex flex-col gap-3 text-sm">
        {post.scheduledAt && (
          <Row label={t('content.publishing.scheduledAt')}>{formatDateTime(post.scheduledAt)}</Row>
        )}
        {post.publishedAt && (
          <Row label={t('content.publishing.publishedAt')}>{formatDateTime(post.publishedAt)}</Row>
        )}
        {post.publishedBy && (
          <Row label={t('content.publishing.publishedBy')}>{post.publishedBy.name}</Row>
        )}
      </dl>
      {published &&
        (post.publishedLinks.length > 0 ? (
          <ul className="flex flex-col gap-2 border-t border-border pt-3">
            {post.publishedLinks.map((link) => (
              <li key={link.platform} className="flex min-w-0 items-center gap-2 text-sm">
                <PlatformMark
                  platform={link.platform}
                  size="sm"
                  label={t(`clients.platforms.names.${link.platform}`)}
                />
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  dir="ltr"
                  className="min-w-0 truncate hover:underline"
                >
                  {formatLink(link.url)}
                </a>
                <ExternalLinkIcon
                  role="img"
                  aria-label={t('common.openInNewTab')}
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            {t('content.publishing.noLinks')}
          </p>
        ))}
      {editing && <PublishedDialog post={post} onClose={() => setEditing(false)} />}
    </TaskSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium tabular-nums">{children}</dd>
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
