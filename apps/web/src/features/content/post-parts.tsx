import { Link } from '@tanstack/react-router';
import type {
  MeResponse,
  Post,
  PostPlatform,
  PostStatus,
  PostType,
  ReviewStage,
  WorkflowStatus,
} from '@vertex-hub/contracts';
import { Avatar, Badge, cn, PlatformMark, StatusBadge } from '@vertex-hub/ui';
import {
  BanIcon,
  CalendarClockIcon,
  ClapperboardIcon,
  GalleryHorizontalEndIcon,
  ImageIcon,
  type LucideIcon,
  SmartphoneIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scopesOf } from '../../lib/auth';
import { formatCalendarDate, formatTimeOfDay } from '../../lib/format';
import { fileThumbnailUrl } from '../files/files.queries';

/*
 * How a post looks wherever it is listed (spec F08, screen 1): its status in the workflow colors,
 * its type and platforms as icons, and the card of the calendar.
 */

/**
 * Edit scope before a post exists: `content.manage` under `all`, or `own_clients` for the client's
 * account manager. Existing posts carry the server's answer in `permissions`. Hides UI only.
 */
export function canEditPostsOf(me: MeResponse, clientAccountManagerId: string): boolean {
  const scopes = scopesOf(me, 'content.manage');
  return (
    scopes.includes('all') ||
    (scopes.includes('own_clients') && clientAccountManagerId === me.user.id)
  );
}

/** The workflow color of each post status (brand/identity.md §2). */
const STATUS_COLOR: Record<Exclude<PostStatus, 'cancelled'>, WorkflowStatus> = {
  idea: 'new',
  in_production: 'in_progress',
  internal_review: 'internal_review',
  awaiting_client: 'awaiting_client',
  approved: 'approved',
  scheduled: 'approved',
  published: 'delivered',
};

/**
 * A post status in its workflow color; cancelled posts are struck from the workflow. With the
 * `stage`, internal review names its medical stage (rule 13).
 */
export function PostStatusBadge({
  status,
  stage,
}: {
  status: PostStatus;
  stage?: ReviewStage | null;
}) {
  const { t } = useTranslation();
  if (status === 'cancelled') {
    return (
      <Badge tone="outline" data-status={status} className="text-muted-foreground">
        <BanIcon aria-hidden="true" />
        {t('content.statuses.cancelled')}
      </Badge>
    );
  }
  return (
    <StatusBadge status={STATUS_COLOR[status]} data-status={status}>
      {stage === 'medical' ? t('content.medicalStatus') : t(`content.statuses.${status}`)}
    </StatusBadge>
  );
}

/** Approved or scheduled with a publish date that has passed. */
export function PostOverdueBadge() {
  const { t } = useTranslation();
  return (
    <Badge tone="danger">
      <CalendarClockIcon aria-hidden="true" />
      {t('content.overdue')}
    </Badge>
  );
}

export const POST_TYPE_ICONS: Record<PostType, LucideIcon> = {
  post: ImageIcon,
  reel: ClapperboardIcon,
  story: SmartphoneIcon,
  carousel: GalleryHorizontalEndIcon,
};

/** The type as an icon, named for assistive technology. */
export function PostTypeIcon({ type, className }: { type: PostType; className?: string }) {
  const { t } = useTranslation();
  const Icon = POST_TYPE_ICONS[type];
  return (
    <Icon
      role="img"
      aria-label={t(`content.types.${type}`)}
      className={cn('size-4 shrink-0 text-muted-foreground', className)}
    />
  );
}

/** The platforms a post goes out on, as their marks. */
export function PostPlatforms({
  platforms,
  size = 'xs',
}: {
  platforms: PostPlatform[];
  size?: 'xs' | 'sm';
}) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap items-center gap-1">
      {platforms.map((platform) => (
        <PlatformMark
          key={platform}
          platform={platform}
          size={size}
          label={t(`clients.platforms.names.${platform}`)}
        />
      ))}
    </span>
  );
}

/** The publish date, with the time when one is set. */
export function formatPublish(post: Pick<Post, 'publishDate' | 'publishTime'>): string {
  const date = formatCalendarDate(post.publishDate);
  return post.publishTime ? `${date} · ${formatTimeOfDay(post.publishTime)}` : date;
}

function PostThumbnail({ versionId, className }: { versionId: string; className?: string }) {
  return (
    <img
      src={fileThumbnailUrl(versionId)}
      alt=""
      loading="lazy"
      className={cn('shrink-0 rounded-sm border border-border object-cover', className)}
    />
  );
}

/**
 * A post on a calendar day: title and type, client and time, then status and platforms. Overdue
 * posts are marked; cancelled ones are dimmed.
 */
export function PostCard({ post, showClient }: { post: Post; showClient: boolean }) {
  const cancelled = post.status === 'cancelled';
  // The time first: a long client name is cut, never the time.
  const meta = [
    post.publishTime ? formatTimeOfDay(post.publishTime) : null,
    showClient ? post.client.name : null,
  ].filter(Boolean);
  return (
    <Link
      to="/content/posts/$postId"
      params={{ postId: post.id }}
      data-post-status={post.status}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface p-1.5 text-xs transition-colors duration-150 ease-out hover:bg-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        post.overdue && 'border-destructive',
        cancelled && 'opacity-60',
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        {post.thumbnailVersionId ? (
          <PostThumbnail versionId={post.thumbnailVersionId} className="size-8" />
        ) : (
          <PostTypeIcon type={post.type} className="mt-0.5 size-3.5" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className={cn('line-clamp-2 font-medium', cancelled && 'line-through')}>
            {post.title}
          </span>
          {meta.length > 0 && (
            <span className="truncate text-muted-foreground tabular-nums">{meta.join(' · ')}</span>
          )}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <PostStatusBadge status={post.status} stage={post.reviewStage} />
        {post.overdue && <PostOverdueBadge />}
        <PostPlatforms platforms={post.platforms} />
      </span>
    </Link>
  );
}

/**
 * Posts as rows: the agenda of the calendar on a phone, a day's list and the sections of My
 * posts. `showDate` leaves the date out where the rows sit under their day.
 */
export function PostRows({
  posts,
  showClient = true,
  showDate = true,
}: {
  posts: Post[];
  showClient?: boolean;
  showDate?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col divide-y divide-border">
      {posts.map((post) => {
        const cancelled = post.status === 'cancelled';
        return (
          <li
            key={post.id}
            className={cn(
              'flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-4',
              cancelled && 'opacity-60',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {post.thumbnailVersionId ? (
                <PostThumbnail versionId={post.thumbnailVersionId} className="size-10" />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted">
                  <PostTypeIcon type={post.type} />
                </span>
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link
                  to="/content/posts/$postId"
                  params={{ postId: post.id }}
                  className={cn(
                    'w-fit max-w-full truncate font-medium hover:underline',
                    cancelled && 'text-muted-foreground line-through',
                  )}
                >
                  {post.title}
                </Link>
                <span className="truncate text-xs text-muted-foreground">
                  {[showClient ? post.client.name : null, t(`content.types.${post.type}`)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm">
                <Avatar
                  name={post.responsible.name}
                  size="sm"
                  tone={post.responsible.archived ? 'muted' : 'brand'}
                />
                {post.responsible.name}
              </span>
              <PostStatusBadge status={post.status} stage={post.reviewStage} />
              <PostPlatforms platforms={post.platforms} />
              <span className="flex items-center gap-2 text-sm tabular-nums">
                {showDate
                  ? formatPublish(post)
                  : post.publishTime && formatTimeOfDay(post.publishTime)}
                {post.overdue && <PostOverdueBadge />}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
