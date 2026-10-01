import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Skeleton } from '@vertex-hub/ui';
import { useTranslation } from 'react-i18next';
import { isMissing, LoadError } from '../../components/load-error';
import { TaskSection } from '../tasks/task-parts';
import { postQuery } from './content.queries';
import { formatPublish, PostStatusBadge } from './post-parts';

/**
 * The Post line of the task page (spec F08, screen 8): the post a linked task produces media
 * for, and what linking changes for the task (rule 7).
 */
export function TaskPostSection({ postId }: { postId: string }) {
  const { t } = useTranslation();
  // Every active user reads posts.
  const post = useQuery(postQuery(postId));
  return (
    <TaskSection title={t('content.taskPost.title')}>
      {post.isPending ? (
        <Skeleton className="h-12" />
      ) : isMissing(post.error) ? (
        // An archived post is hidden from everyone but its scope-all reviewers.
        <p className="text-sm text-muted-foreground">{t('content.taskPost.unavailable')}</p>
      ) : post.isError ? (
        <LoadError message={t('content.page.loadError')} onRetry={() => post.refetch()} />
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <Link
            to="/content/posts/$postId"
            params={{ postId }}
            className="w-fit max-w-full truncate font-medium hover:underline"
          >
            {post.data.title}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <PostStatusBadge status={post.data.status} stage={post.data.reviewStage} />
            <span className="text-muted-foreground tabular-nums">
              {t('content.taskPost.publish', { date: formatPublish(post.data) })}
            </span>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('content.taskPost.hint')}</p>
    </TaskSection>
  );
}
